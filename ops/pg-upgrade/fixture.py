"""Fingerprint the populated qualification database on both sides of a major upgrade."""

from hashlib import sha256
import json
import os
import sys
from uuid import uuid4

import django
from django.db import connection, transaction

django.setup()
from core.content.models import AttachmentBlob, AttachmentBody, AttachmentLink, ItemNote
from core.models import Item, ItemTag, Membership, Tag, Workspace


def verify_runtime():
    if os.environ.get("APP_ENV") != "development" or connection.settings_dict["HOST"] not in {"db", "test-db"}:
        raise ValueError("Use the disposable PostgreSQL major-upgrade stack.")
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT current_user = 'fpapp' AND has_table_privilege('core_item', 'UPDATE')
               AND NOT has_table_privilege('django_migrations', 'UPDATE')
               AND NOT has_schema_privilege('public', 'CREATE')
        """)
        if cursor.fetchone() != (True,):
            raise ValueError("Unexpected application database privileges.")


def attach():
    item = Item.objects.get(title="Action 00023", kind="action")
    raw = bytes(range(256)) * 4096
    workspace = item.workspace
    with transaction.atomic():
        blob = AttachmentBlob.objects.create(workspace=workspace, size=len(raw),
                                             sha256=sha256(raw).hexdigest(), media_type="application/octet-stream")
        AttachmentBody.objects.create(blob=blob, data=raw)
        AttachmentLink.objects.create(id=uuid4(), workspace=workspace, item=item, blob=blob, filename="pg-upgrade.bin")


def fingerprint():
    link = AttachmentLink.objects.select_related("item", "blob").get(filename="pg-upgrade.bin")
    raw = bytes(AttachmentBody.objects.get(blob=link.blob).data)
    if (link.item.title != "Action 00023" or link.workspace_id != link.item.workspace_id
            or link.workspace_id != link.blob.workspace_id or link.blob.size != 1_048_576
            or len(raw) != link.blob.size or sha256(raw).hexdigest() != link.blob.sha256):
        raise ValueError("Attachment content, identity or ownership changed.")
    items = Item.objects.filter(workspace_id=link.workspace_id)
    if (items.filter(kind="action").count(), items.filter(kind="group").count(),
            items.filter(kind="project").count(), ItemNote.objects.filter(workspace_id=link.workspace_id).count()
            ) != (10_000, 1_000, 100, 434):
        raise ValueError("Expected the complete representative workspace.")
    digest = sha256(raw)
    relations = (Workspace, Membership, Item, Tag, ItemTag, ItemNote, AttachmentBlob, AttachmentLink)
    for model in relations:
        digest.update(model._meta.label.encode() + b"\n")
        for row in model.objects.order_by("pk").values().iterator():
            if model is Workspace:
                row.pop("generation")  # The recovery fence intentionally rotates this value.
            digest.update(json.dumps(row, sort_keys=True, default=str).encode() + b"\n")
    return digest.hexdigest()


verify_runtime()
if sys.argv[1:] == ["attach"]:
    attach()
elif sys.argv[1:] == ["fingerprint"]:
    print(fingerprint())
else:
    sys.exit("Select attach or fingerprint.")
