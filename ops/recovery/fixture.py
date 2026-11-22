"""Inspect only synthetic QA databases through the candidate runtime and its real URL routes."""

from datetime import timedelta
import hashlib
import json
import os
import sys
import uuid

import django
from django.db import connection, transaction
from django.test import Client
from django.utils import timezone

django.setup()
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session

from core.content.models import AttachmentBlob, AttachmentBody, AttachmentLink
from core.integrations.models import PushDevice, Reminder, ReminderDelivery
from core.models import Change, Item, Job, Receipt, Workspace


LEASED = "qa-restore-before-cut"
LATER = "qa-restore-after-cut"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def client():
    return Client(HTTP_HOST="localhost", REMOTE_ADDR="192.0.2.40", enforce_csrf_checks=True)


@transaction.atomic
def seed():
    # Use the dedicated large fixture, separate from the browser smoke accounts.
    item = Item.objects.select_related("workspace__private_owner").get(title="Action 10000")
    workspace = item.workspace
    owner = workspace.private_owner
    data = os.urandom(4 * 1024 * 1024)
    blob = AttachmentBlob.objects.create(workspace=workspace, size=len(data), media_type="application/octet-stream",
                                         sha256=hashlib.sha256(data).hexdigest())
    AttachmentBody.objects.create(blob=blob, data=data)
    AttachmentLink.objects.create(workspace=workspace, item=item, blob=blob, filename="qa-restore.bin")
    due = timezone.now() + timedelta(days=1)
    reminder = Reminder.objects.create(public_id=uuid.uuid4(), workspace=workspace, user=owner,
                                       item=item, at=due, status="due")
    device = PushDevice.objects.create(user=owner, device=uuid.uuid4(), endpoint="https://fixture.invalid/push")
    delivery = ReminderDelivery.objects.create(reminder=reminder, device=device, status="sending")
    Job.objects.create(workspace=workspace, actor=owner, kind="reminder-push", dedupe_key=LEASED,
                       payload={"delivery": delivery.pk}, status="running", attempts=1,
                       lease_until=due, lease_token=uuid.uuid4())
    client().force_login(owner)


def later_write():
    job = Job.objects.get(dedupe_key=LEASED)
    Job.objects.create(workspace_id=job.workspace_id, actor_id=job.actor_id,
                       dedupe_key=LATER, kind="workspace-revision-probe", next_attempt_at=job.lease_until)


def digest_rows(*rowsets):
    digest = hashlib.sha256()
    for rows in rowsets:
        for row in rows.order_by("pk").iterator(chunk_size=300):
            digest.update(json.dumps(row, sort_keys=True, default=str).encode())
            digest.update(b"\n")
        digest.update(b"\x00")
    return digest.hexdigest()


def immutable_digest():
    users = get_user_model()
    return digest_rows(
        users.objects.values(), users.groups.through.objects.values(), users.user_permissions.through.objects.values(),
        Receipt.objects.values("workspace_id", "actor_id", "context_id", "operation_id", "fingerprint", "result"),
        Change.objects.values(),
    )


def snapshot():
    # Keep account credentials, job payloads and session identifiers inside their database process.
    require(Session.objects.exists(), "The pre-fence fixture requires a live session.")
    require(not Job.objects.filter(dedupe_key=LATER).exists(), "A post-cut write crossed the restore point.")
    job = Job.objects.get(dedupe_key=LEASED)
    require(job.status == "running" and job.lease_token and job.lease_until, "Missing in-flight lease.")
    require(ReminderDelivery.objects.get(pk=job.payload["delivery"]).status == "sending", "Missing in-flight delivery.")
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_database_size(current_database())")
        database_bytes = cursor.fetchone()[0]
    return {
        "immutable": immutable_digest(),
        "point": digest_rows(Job.objects.values(), Session.objects.values(), ReminderDelivery.objects.values(),
                             Workspace.objects.values("id", "generation")),
        "database_bytes": database_bytes,
        "actions": Item.objects.filter(kind="action").count(),
        "jobs": Job.objects.count(),
        "sessions": Session.objects.count(),
        "workspaces": Workspace.objects.count(),
        "attachment_bytes": sum(AttachmentBlob.objects.values_list("size", flat=True)),
    }


def check_fence():
    require(not Session.objects.exists(), "A restored session survived the fence.")
    require(not Job.objects.filter(status__in=["pending", "running"]).exists(), "Restored work can still be claimed.")
    job = Job.objects.get(dedupe_key=LEASED)
    require(job.status == "failed" and job.last_error == "restore_reconciliation" and job.attempts == 1
            and job.lease_token is None and job.lease_until is None, "The uncertain job escaped quarantine.")
    delivery = ReminderDelivery.objects.select_related("device", "reminder").get(pk=job.payload["delivery"])
    require(delivery.status == "uncertain" and not delivery.device.enabled and delivery.reminder.status == "paused",
            "The restore fence left an uncertain delivery eligible to send.")
    require(not Job.objects.filter(dedupe_key=LATER).exists(), "The recovered database includes a post-cut write.")
    return immutable_digest()


def check_isolation():
    owner, neighbor, _ = json.load(sys.stdin)
    for account, other in [(owner, neighbor), (neighbor, owner)]:
        browser = client()
        token = browser.get("/api/v1/session").json()["csrfToken"]
        login = browser.post("/api/v1/login", {"username": account["username"], "password": account["password"]},
                             content_type="application/json", HTTP_X_CSRFTOKEN=token)
        require(login.status_code == 200 and login.json()["workspaces"] == [{"id": account["workspace"], "role": "owner"}],
                "Recovered account ownership changed.")
        path = "/api/v1/workspaces/{}/snapshot"
        require(browser.get(path.format(account["workspace"])).status_code == 200, "Recovered owner lost access.")
        require(browser.get(path.format(other["workspace"])).status_code == 404, "Recovered private boundary failed.")


def main(phase):
    targets = {
        "seed": ("db", "focuspocus"), "snapshot": ("db", "focuspocus"), "later": ("db", "focuspocus"),
        "source": ("db", "focuspocus"), "restored": ("test-db", "restored_fixture"),
        "fenced": ("test-db", "restored_fixture"), "isolation": ("test-db", "restored_fixture"),
        "unready": ("test-db", "failed_fixture"), "release_head": ("test-db", "failed_fixture"),
    }
    require(os.environ.get("APP_ENV") == "development"
            and (connection.settings_dict["HOST"], connection.settings_dict["NAME"]) == targets[phase],
            "Recovery fixtures require their disposable database.")
    if phase == "seed":
        seed()
    elif phase == "later":
        later_write()
    elif phase in ("snapshot", "restored"):
        print(json.dumps(snapshot()))
    elif phase == "fenced":
        print(check_fence())
    elif phase == "isolation":
        check_isolation()
    elif phase == "release_head":
        from django.db.migrations.executor import MigrationExecutor

        heads = MigrationExecutor(connection).loader.graph.leaf_nodes("core")
        require(len(heads) == 1, "Expected a single merged release migration head.")
        print(heads[0][1])
    elif phase == "unready":
        require(client().get("/api/v1/health/ready").status_code == 503, "Partial schema admitted a web process.")
    elif phase == "source":
        require(Job.objects.filter(dedupe_key=LATER).exists(), "Source lost the post-cut write.")
        require(Job.objects.get(dedupe_key=LEASED).status == "running", "Rehearsal modified the source job.")
        require(client().get("/api/v1/health/ready").status_code == 200, "Rehearsal disturbed source readiness.")


if __name__ == "__main__":
    main(sys.argv[1])
