"""Restore only into a new workspace; imported operation history is read-only."""
from hashlib import sha256
import re
from uuid import uuid5

from django.conf import settings
from django.db import connection, transaction
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_naive
from core.commands.service import scoped_workspace
from core.commands.validation import CommandError, fields, identifier
from core.content.images import detected_type
from core.content.models import AttachmentBody
from core.imports.portable import restore_batches
from core.integrations.portable import restore_settings
from core.models import Membership, Workspace
from core.sharing.models import SharedWorkspace

from .archive import counts, digest, open_bundle
from .models import RestoredHistory, RestoredReviewer, RestoreReceipt
from .personal import restore_personal
from .records import TABLES
from .validation import decode_records


def validate_files(archive, groups):
    blobs = {row["id"]: row for row in groups["blobs"]}
    sizes = [blobs[row["blob_id"]]["size"] for row in groups["files"]]
    if (sum(sizes) > settings.WORKSPACE_ATTACHMENT_MAX_BYTES or
            any(size > settings.ATTACHMENT_MAX_BYTES for size in sizes)):
        raise CommandError("The bundle exceeds the configured attachment quota.", 413)
    linked = {row["blob_id"] for row in groups["files"]}
    names = {"manifest.json", "records.json"}
    for pk, row in blobs.items():
        name = "files/" + row["sha256"]
        if pk not in linked or name in names or archive.getinfo(name).file_size != row["size"]:
            raise ValueError("Invalid or unreferenced file entry.")
        raw = archive.read(name)
        if digest(raw) != row["sha256"] or detected_type(raw, row["media_type"]) != row["media_type"]:
            raise ValueError("Invalid file checksum or type.")
        names.add(name)
    if names != set(archive.namelist()):
        raise ValueError("Unexpected bundle member.")


def write_history(workspace, rows, item_ids):
    if not isinstance(rows, list):
        raise ValueError("Invalid history.")
    events = []
    for row in rows:
        fields(row, ["at", "action", "items"])
        stamp = parse_datetime(row["at"])
        if (not stamp or is_naive(stamp) or not re.fullmatch(r"[a-z][a-z0-9-]{0,79}", row["action"])
                or not isinstance(row["items"], list)):
            raise ValueError("Invalid historical change.")
        ids = []
        for key in row["items"]:
            key = str(identifier(key))
            ids.append(str(item_ids[key] if key in item_ids else uuid5(workspace.generation, "items:" + key)))
        events.append(RestoredHistory(workspace=workspace, occurred_at=stamp, action=row["action"], item_ids=ids))
    RestoredHistory.objects.bulk_create(events, batch_size=500)


def validate_memberships(descriptors):
    if not isinstance(descriptors, list) or len(descriptors) > 3:
        raise ValueError("Unexpected membership descriptors.")
    roles = set()
    for row in descriptors:
        fields(row, ["role", "count"])
        if row["role"] in roles or row["role"] not in ("owner", "editor", "viewer") or type(row["count"]) is not int or row["count"] < 1:
            raise ValueError("Invalid membership description.")
        roles.add(row["role"])


def materialize(workspace, actor, records, groups, maps, archive, personal, account):
    for table in TABLES:
        model = table.model
        model.objects.bulk_create((model(workspace=workspace, **row) for row in groups[table.name]), batch_size=500)
    for row in groups["blobs"]:
        AttachmentBody.objects.create(blob_id=row["id"], data=archive.read("files/" + row["sha256"]))
    reviewed = {row["project_id"]: row["last_reviewed_at"] for row in groups["reviews"] if row["last_reviewed_at"]}
    origins = []
    for descriptor in records["reviewSources"]:
        fields(descriptor, ["project", "reviewer"])
        project = maps["items"].get(descriptor["project"])
        if project not in reviewed or not re.fullmatch(r"member:[0-9]{1,20}", descriptor["reviewer"]):
            raise ValueError("Invalid historical reviewer.")
        origins.append(RestoredReviewer(project_id=project, source_label=descriptor["reviewer"], reviewed_at=reviewed[project]))
    RestoredReviewer.objects.bulk_create(origins, batch_size=500)
    write_history(workspace, records["history"], maps["items"])
    restore_batches(workspace, records["imports"], maps["items"], maps["tags"])
    private = records["personal"] if personal else None
    if personal and private is None:
        raise ValueError("This bundle has no personal section.")
    if private is not None:
        restore_personal(workspace, actor, private, maps, account)
    adapters = {"schema": 1, "places": records["places"],
                "reminders": private["reminders"] if private else [], "calendars": private["calendars"] if private else []}
    restore_settings(workspace, actor if private is not None else None, adapters, maps["items"], maps["tags"])


def restore(source_id, actor, operation, upload, signature, personal, account):
    if account and not personal:
        raise ValueError("Restoring account settings requires the personal section.")
    signature = sha256(f"{signature}:{personal}:{account}".encode()).hexdigest()
    archive, records = open_bundle(upload)
    with archive:
        groups, maps = decode_records(records)
        validate_memberships(records["memberships"])
        validate_files(archive, groups)
        with transaction.atomic():
            source = scoped_workspace(actor, source_id, owner=True)
            previous = RestoreReceipt.objects.filter(source=source, actor=actor, operation=operation).first()
            if previous:
                if previous.fingerprint != signature:
                    raise CommandError("This operation was already used for a different restore.", 409)
                if not previous.destination_id:
                    raise CommandError("The restored workspace has been removed.", 409)
                scoped_workspace(actor, previous.destination_id, owner=True)
                return {"workspaceId": str(previous.destination_id), "revision": 0, "counts": previous.counts}
            meta = records["workspace"]
            workspace = Workspace.objects.create(time_zone=meta["timeZone"], date_defaults=meta["dateDefaults"],
                                                 filing_policy=meta["filingPolicy"])
            SharedWorkspace.objects.create(workspace=workspace, name=meta["name"])
            Membership.objects.create(workspace=workspace, user=actor, role="owner")
            materialize(workspace, actor, records, groups, maps, archive, personal, account)
            # Fail inside this savepoint, including in a caller's outer transaction.
            with connection.cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute("SET CONSTRAINTS ALL DEFERRED")
            totals = counts(records)
            RestoreReceipt.objects.create(source=source, actor=actor, operation=operation, fingerprint=signature,
                                          destination=workspace, counts=totals)
            return {"workspaceId": str(workspace.pk), "revision": workspace.revision, "counts": totals}
