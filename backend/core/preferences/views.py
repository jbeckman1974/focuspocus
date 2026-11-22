from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from core.commands.service import scoped_workspace
from core.commands.validation import CommandError, fields
from core.commands.views import read_body

from .models import AccountPreference, DevicePreference
from .settings import DEVICE_DEFAULTS, account_values, update_account, update_device


@never_cache
@require_http_methods(["GET", "PATCH"])
def preferences(request, workspace_id, device=None):
    try:
        with transaction.atomic():
            workspace = scoped_workspace(request.user, workspace_id)
            scope = {"user": request.user}
            model = AccountPreference
            if device is not None:
                model = DevicePreference
                scope.update(workspace=workspace, device=device)
            if request.method == "PATCH":
                body = read_body(request)
                fields(body, ["changes", "expectedVersion"])
                if type(body["expectedVersion"]) is not int or body["expectedVersion"] < 0 or not body["changes"]:
                    raise CommandError("Supply a preference version and at least one changed field.")
                record, _ = model.objects.get_or_create(**scope)
                record = model.objects.select_for_update().get(pk=record.pk)
                if record.version != body["expectedVersion"]:
                    raise CommandError("Preferences changed in another browser.", 409)
                update = update_device if device is not None else update_account
                value = update(record.values, body["changes"])
                if value != record.values:
                    record.values, record.version = value, record.version + 1
                    record.save(update_fields=["values", "version"])
            else:
                record = model.objects.filter(**scope).first()
            raw = record.values if record else {}
            values = {**DEVICE_DEFAULTS, **raw} if device is not None else account_values(workspace, raw)
            return JsonResponse({"version": record.version if record else 0, "values": values})
    except CommandError as error:
        return JsonResponse({"error": str(error)}, status=error.status)
