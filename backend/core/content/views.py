"""Authenticated item content. Reads recheck membership and active item links."""

from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.utils.http import content_disposition_header
from django.views.decorators.http import require_GET, require_POST

from core.commands.service import execute, scoped_workspace
from core.commands.state import Outline
from core.commands.validation import CommandError, identifier

from .commands import changed, versioned_item
from .files import detected_type, file_name, read_upload, store_upload
from .images import png_preview
from .models import AttachmentBody, AttachmentLink, ItemNote
from .notes import EMPTY_NOTE


@require_GET
def item_content(request, workspace_id, item_id):
    try:
        with transaction.atomic():
            space = scoped_workspace(request.user, workspace_id)
            item = Outline(space).get(item_id)
            note = ItemNote.objects.filter(workspace=space, item=item).values_list("document", flat=True).first()
            links = AttachmentLink.objects.filter(workspace=space, item=item).select_related("blob").order_by("filename", "id")
            return JsonResponse({
                "revision": space.revision, "itemVersion": item.version, "document": note or EMPTY_NOTE,
                "files": [{"id": str(link.pk), "name": link.filename, "size": link.blob.size,
                           "sha256": link.blob.sha256, "mediaType": link.blob.media_type,
                           "previewable": link.blob.media_type == "image/png"} for link in links],
            })
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)


def integer_header(request, name):
    raw = request.headers.get(name, "")
    if not raw.isascii() or not raw.isdecimal() or len(raw) > 19:
        raise CommandError("A valid unmodified revision and item version are required.", 428)
    return int(raw)


@require_POST
def attach(request, workspace_id, item_id):
    try:
        with transaction.atomic():
            space = scoped_workspace(request.user, workspace_id, write=True)
            Outline(space).get(item_id)
        filename = file_name(request.headers.get("X-File-Name", ""))
        link_id = identifier(request.headers.get("X-File-Id"))
        op = str(identifier(request.headers.get("X-Operation-Id")))
        context = request.headers.get("X-Write-Context", "")
        item_version = integer_header(request, "X-Item-Version")
        revision = integer_header(request, "X-Workspace-Revision")
        raw, checksum = read_upload(request)
        media_type = detected_type(raw, request.headers.get("X-File-Type", ""))
        payload = {"id": str(item_id), "fileId": str(link_id), "name": filename, "size": len(raw),
                   "sha256": checksum, "mediaType": media_type, "itemVersion": item_version}

        def apply_file(tree, verified):
            item = versioned_item(tree, verified)
            store_upload(tree, item, link_id, filename, checksum, media_type, raw)
            return changed(item)

        receipt = execute(request.user, workspace_id, "attach-file", {
            "operationId": op, "context": context, "expectedRevision": revision, "payload": payload,
        }, command_handler=apply_file)
        return JsonResponse(receipt)
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
    except IntegrityError as error:
        if getattr(error.__cause__, "sqlstate", None) != "23505":
            raise
        return JsonResponse({"error": "File identity unavailable."}, status=409)


@require_GET
def file_bytes(request, workspace_id, item_id, file_id, *, preview=False):
    try:
        with transaction.atomic():
            space = scoped_workspace(request.user, workspace_id)
            item = Outline(space).get(item_id)
            link = AttachmentLink.objects.filter(workspace=space, item=item, id=file_id).select_related("blob").first()
            if link is None:
                raise CommandError("File unavailable.", 404)
            if preview and link.blob.media_type != "image/png":
                raise CommandError("Preview unavailable for this format.", 415)
            raw = bytes(AttachmentBody.objects.values_list("data", flat=True).get(blob_id=link.blob_id))
        if preview:
            raw = png_preview(raw)
            if raw is None:
                raise CommandError("Preview unavailable for this file.", 415)
        response = HttpResponse(raw, content_type="image/png" if preview else "application/octet-stream")
        response["Content-Disposition"] = content_disposition_header(not preview, link.filename)
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Referrer-Policy"] = "no-referrer"
        return response
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
