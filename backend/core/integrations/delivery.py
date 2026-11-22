import http.client

from django.db import transaction
from django.utils import timezone

from core.models import Job
from core.queries.records import read_records

from . import push
from .authority import job_workspace
from .configuration import AdapterError
from .models import PushDevice, Reminder, ReminderDelivery
from .reminders import PUSH


def live_job(job):
    return Job.objects.select_for_update().filter(pk=job.pk, status="running", lease_token=job.lease_token,
                                                  lease_until__gt=timezone.now()).exists()


def eligible(reminder, workspace):
    if reminder.item.workspace_id != workspace.pk or reminder.item.shelf != "active":
        return False
    rows, _, _ = read_records(workspace)
    return any(row["id"] == str(reminder.item_id) and row["effective"]["remaining"] for row in rows)


@transaction.atomic
def make_due(job):
    workspace = job_workspace(job)
    if not workspace or not live_job(job):
        return "authorization_revoked"
    reminder = Reminder.objects.filter(pk=job.payload.get("reminder"), workspace=workspace,
                                       user_id=job.actor_id).select_related("item").first()
    if not reminder or reminder.status != "scheduled":
        return ""
    if not eligible(reminder, workspace):
        reminder.status = "cancelled"
    else:
        reminder.status = "due"
        for device in PushDevice.objects.filter(user_id=job.actor_id, enabled=True):
            delivery, _ = ReminderDelivery.objects.get_or_create(reminder=reminder, device=device)
            Job.objects.get_or_create(workspace=workspace, dedupe_key=f"push:{delivery.pk}", defaults={
                "actor_id": job.actor_id, "kind": PUSH, "payload": {"delivery": delivery.pk}})
    reminder.save(update_fields=["status"])
    return ""


@transaction.atomic
def begin(job):
    workspace = job_workspace(job)
    if not workspace or not live_job(job):
        return None, "authorization_revoked"
    attempts = ReminderDelivery.objects.filter(
        pk=job.payload.get("delivery"), reminder__workspace=workspace, reminder__user_id=job.actor_id,
        device__user_id=job.actor_id)
    # All workspaces of an account share its devices. A concurrent unsubscribe or
    # re-enrollment takes this same device lock before changing pending deliveries.
    if not PushDevice.objects.select_for_update().filter(pk__in=attempts.values("device_id")).exists():
        return None, ""
    attempt = attempts.select_related("device", "reminder__item").first()
    if not attempt or attempt.status in ("sent", "expired", "failed", "uncertain", "cancelled"):
        return None, ""
    if attempt.status == "sending":
        # A prior worker crossed the durable dispatch boundary and never acknowledged the outcome.
        attempt.status = "uncertain"
    elif (attempt.reminder.status != "due" or not attempt.device.enabled
          or not eligible(attempt.reminder, workspace)):
        attempt.status = "cancelled"
    else:
        attempt.status = "sending"
    attempt.save(update_fields=["status"])
    return (attempt, "") if attempt.status == "sending" else (None, attempt.status)


def deliver(job):
    from core.sync.jobs import MAX_ATTEMPTS, RetryJob

    attempt, reason = begin(job)
    if attempt is None:
        return reason
    try:
        status = push.send(attempt.device)
        if 200 <= status < 300:
            result = "sent"
        elif status in (404, 410):
            result = "expired"
        elif status == 429 and job.attempts < MAX_ATTEMPTS:
            result = "pending"
        else:
            result = "failed" if 400 <= status < 500 else "uncertain"
    except AdapterError:
        result = "failed"
    except (OSError, http.client.HTTPException):
        result = "uncertain"
    with transaction.atomic():
        if not live_job(job):
            return "lease_lost"
        ReminderDelivery.objects.filter(pk=attempt.pk, status="sending").update(status=result)
        if result == "expired":
            PushDevice.objects.filter(pk=attempt.device_id, endpoint_digest=attempt.device.endpoint_digest).update(
                enabled=False)
    if result == "pending":
        raise RetryJob("provider_throttled")
    return "" if result == "sent" else result
