"""Authenticated workspace portability. Binary transfers bypass Django's small JSON body limit."""
from hashlib import sha256
from tempfile import TemporaryFile
from zipfile import BadZipFile, LargeZipFile

from django.core.exceptions import ValidationError
from django.db import DataError, IntegrityError, transaction
from django.http import FileResponse, JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from core.commands.service import scoped_workspace
from core.commands.validation import CommandError, identifier

from .archive import limit, write_bundle
from .outline_csv import outline_csv
from .personal import personal_settings
from .records import export_records, history_rows, review_sources
from .restore import restore


def flag(params, key):
    value = params.get(key, "0")
    if value not in ("0", "1") or len(params.getlist(key)) > 1:
        raise CommandError(f"Use 0 or 1 for {key}.", 400)
    return value == "1"


@never_cache
@require_GET
def download(request, workspace_id, mode):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id, owner=mode in ("bundle", "csv"))
            if mode == "csv":
                return outline_csv(workspace, request.GET.getlist("id"))
            if mode == "personal":
                result = JsonResponse(personal_settings(workspace, request.user))
                result["Content-Disposition"] = 'attachment; filename="focuspocus-personal.json"'
                return result
            if mode == "history":
                return JsonResponse({"history": list(history_rows(workspace)), "reviewSources": review_sources(workspace)})
            records, bodies = export_records(workspace, request.user, flag(request.GET, "personal"))
            handle = write_bundle(workspace, records, bodies)
            return FileResponse(handle, as_attachment=True, filename="focuspocus-workspace.zip", content_type="application/zip")
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
    except (ValueError, LargeZipFile):
        return JsonResponse({"error": "The workspace exceeds supported export limits or contains inconsistent records."}, status=422)


@never_cache
@require_POST
def import_bundle(request, workspace_id):
    try:
        # Authorize before reading or spooling any uploaded bytes. Reauthorize to commit.
        with transaction.atomic():
            scoped_workspace(request.user, workspace_id, owner=True)
        operation = identifier(request.headers.get("X-Operation-Id"))
        if request.content_type != "application/zip":
            raise CommandError("Send a workspace ZIP bundle.", 415)
        try:
            size = int(request.META.get("CONTENT_LENGTH", ""))
        except ValueError as error:
            raise CommandError("A bounded content length is required.", 411) from error
        if not 0 < size <= limit():
            raise CommandError("Unsupported workspace bundle length.", 413)
        with TemporaryFile() as file:
            checksum = sha256()
            remaining = size
            while remaining:
                chunk = request.read(min(remaining, 256 * 1024))
                if not chunk:
                    raise ValueError("Truncated workspace upload.")
                file.write(chunk)
                checksum.update(chunk)
                remaining -= len(chunk)
            output = restore(workspace_id, request.user, operation, file, checksum.hexdigest(),
                             flag(request.GET, "personal"), flag(request.GET, "accountSettings"))
        return JsonResponse(output)
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
    except (BadZipFile, LargeZipFile, EOFError, ValueError, TypeError, KeyError, AttributeError, OverflowError,
            RecursionError, ValidationError, DataError, IntegrityError, NotImplementedError):
        return JsonResponse({"error": "Invalid or incompatible workspace bundle."}, status=422)
