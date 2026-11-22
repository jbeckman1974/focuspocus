"""Check the deployed runtime role; hash ordered synthetic content for recovery comparison."""

import hashlib
import json

import django
from django.db import connection

django.setup()
from core.content.models import AttachmentBlob, AttachmentBody, AttachmentLink, ItemNote
from core.imports.models import ImportBatch, ImportMapping
from core.integrations.models import TagPlace
from core.models import Item, ItemTag, Membership, Tag, Workspace
from core.perspectives.models import PerspectiveState, SavedPerspective
from core.planning.models import ProjectReview
from core.portability.models import RestoredHistory, RestoredReviewer, RestoreReceipt
from core.preferences.models import AccountPreference, DevicePreference
from core.repeats.models import Occurrence, RepeatSeries
from core.sharing.models import SharedWorkspace


def check_grants():
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT current_user = 'fpapp', NOT rolsuper, NOT rolcreaterole,
                   NOT rolcreatedb, NOT rolbypassrls, NOT rolreplication,
                   NOT has_schema_privilege(current_user, 'public', 'CREATE'),
                   NOT has_database_privilege(current_user, current_database(), 'CREATE'),
                   NOT has_database_privilege(current_user, current_database(), 'TEMP'),
                   NOT has_table_privilege(current_user, 'django_migrations', 'UPDATE'),
                   has_table_privilege(current_user, 'core_item', 'UPDATE')
              FROM pg_roles WHERE rolname = current_user
        """)
        privileges = cursor.fetchone()
        if not privileges or not all(privileges):
            raise RuntimeError("The runtime role grants differ from the deployment contract")


def check_planning_fixture():
    attachment = AttachmentLink.objects.select_related("blob", "item").get(filename="m4-field-check.txt")
    expected = "Field book fixture\nPoint 17 · Café\n".encode()
    if attachment.blob.sha256 != hashlib.sha256(expected).hexdigest() or attachment.item.title != "Bench route":
        raise RuntimeError("The planning journey's attachment content or item link changed")
    workspace = attachment.workspace_id
    if not ProjectReview.objects.filter(workspace_id=workspace, project=attachment.item.parent_id,
                                        last_reviewed_at__isnull=False).exists():
        raise RuntimeError("The planning journey's reviewed project is missing")
    if not ItemNote.objects.filter(item_id=attachment.item_id, plain_text__contains="monument").exists():
        raise RuntimeError("The attachment's indexed task note is missing")
    saved = SavedPerspective.objects.select_related("state").get(state__workspace_id=workspace,
                                                                 favorite=True, name="Field work this week")
    if saved.state.focus_ids != [str(attachment.item.parent_id)]:
        raise RuntimeError("The planning journey's perspective lost its project focus")
    if not AccountPreference.objects.filter(user_id=saved.state.user_id, values__density="compact").exists():
        raise RuntimeError("The planning account's row density was lost")
    if not DevicePreference.objects.filter(workspace_id=workspace, user_id=saved.state.user_id,
                                           values__inspectorOpen=False).exists():
        raise RuntimeError("The planning account's device layout was lost")


def hash_bodies(digest):
    digest.update(b"attachment-bytes\n")
    bodies = AttachmentBody.objects.select_related("blob").order_by("pk")
    if bodies.count() != AttachmentBlob.objects.count():
        raise RuntimeError("An attachment metadata record is missing its content")
    for body in bodies.iterator(chunk_size=1):
        content = bytes(body.data)
        checksum = hashlib.sha256(content).hexdigest()
        if len(content) != body.blob.size or checksum != body.blob.sha256:
            raise RuntimeError("Attachment bytes differ from their SQL metadata")
        digest.update(f"{body.pk} {checksum}\n".encode())


def content_digest():
    if Workspace.objects.count() < 2 or not Item.objects.exists():
        raise RuntimeError("Browser fixtures did not leave two private workspaces and a saved item")
    if not Occurrence.objects.filter(predecessor__outcome="completed").exists():
        raise RuntimeError("Browser fixtures did not persist a recurring successor and its predecessor")
    check_planning_fixture()
    if not (ImportBatch.objects.filter(status="rolled_back").exists()
            and ImportMapping.objects.filter(active=True).exists()
            and RestoreReceipt.objects.filter(destination__isnull=False).exists()):
        raise RuntimeError("The import, restore and guarded rollback journey did not persist its provenance")
    digest = hashlib.sha256()
    for model in (Workspace, Item, Tag, ItemTag, RepeatSeries, Occurrence,
                  ProjectReview, PerspectiveState, SavedPerspective, ItemNote, AttachmentLink, AttachmentBlob,
                  AccountPreference, DevicePreference, Membership, SharedWorkspace, ImportBatch, ImportMapping,
                  RestoreReceipt, RestoredHistory, RestoredReviewer, TagPlace):
        digest.update(model._meta.label.encode("utf-8") + b"\n")
        for row in model.objects.order_by("pk").values().iterator():
            if model is Workspace:
                row.pop("generation")  # A restored workspace deliberately receives a new generation.
            digest.update(json.dumps(row, sort_keys=True, default=str).encode("utf-8"))
            digest.update(b"\n")
    hash_bodies(digest)
    return digest.hexdigest()


check_grants()
print(content_digest())
