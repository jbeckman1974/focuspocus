from hashlib import sha256
import re
import unicodedata
from urllib.parse import unquote

from django.conf import settings
from django.db.models import Sum

from core.commands.validation import CommandError

from .images import detected_type
from .models import AttachmentBlob, AttachmentBody, AttachmentLink


def file_limit():
    return settings.ATTACHMENT_MAX_BYTES


def workspace_limit():
    return settings.WORKSPACE_ATTACHMENT_MAX_BYTES


def check_capacity(workspace, logical, physical=0):
    linked = AttachmentLink.objects.filter(workspace=workspace).aggregate(n=Sum("blob__size"))["n"] or 0
    if linked + logical > workspace_limit():
        raise CommandError("The workspace attachment quota would be exceeded.", 413)
    if physical:
        # A blob can still be needed by an existing undo or redo record after unlinking.
        retained = AttachmentBlob.objects.filter(workspace=workspace).aggregate(n=Sum("size"))["n"] or 0
        if retained + physical > workspace_limit():
            raise CommandError("The workspace file storage limit would be exceeded.", 413)


def file_name(value):
    try:
        name = unquote(value, errors="strict")
    except (UnicodeDecodeError, TypeError) as error:
        raise CommandError("Invalid filename.") from error
    if (not 1 <= len(name.strip()) <= 200 or name != name.strip() or name in {".", ".."}
            or any(c in "/\\" or unicodedata.category(c).startswith("C") for c in name)):
        raise CommandError("Use a printable filename without a path.")
    return name


def read_upload(request):
    if request.content_type != "application/octet-stream":
        raise CommandError("Send a single binary file.", 415)
    raw_length = request.META.get("CONTENT_LENGTH", "")
    if not re.fullmatch(r"[0-9]{1,12}", str(raw_length)):
        raise CommandError("A bounded upload length is required.", 411)
    size = int(raw_length)
    if size > file_limit():
        raise CommandError("The file exceeds the per-attachment limit.", 413)
    expected = request.headers.get("X-File-Sha256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise CommandError("A SHA-256 checksum is required.")
    # Never use request.body, multipart parsing or an unbounded read. The bytes
    # live only for this request until the authorized transaction links them.
    raw = request.read(size + 1)
    if len(raw) != size or sha256(raw).hexdigest() != expected:
        raise CommandError("File length or checksum mismatch.")
    return raw, expected


def store_upload(tree, item, file_id, filename, digest, media_type, raw):
    blob = AttachmentBlob.objects.filter(workspace=tree.workspace, sha256=digest).first()
    check_capacity(tree.workspace, len(raw), 0 if blob else len(raw))
    if blob is None:
        blob = AttachmentBlob.objects.create(workspace=tree.workspace, size=len(raw), sha256=digest, media_type=media_type)
        AttachmentBody.objects.create(blob=blob, data=raw)
    return AttachmentLink.objects.create(id=file_id, workspace=tree.workspace, item=item, filename=filename, blob=blob)
