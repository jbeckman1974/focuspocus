"""Bound each maintenance transaction and serialize it with export and receipt replay."""

from django.db import transaction
from django.utils import timezone

from core.models import Change, Receipt, Workspace
from core.portability.models import RestoredHistory
from core.portability.records import journal_summary
from core.sharing.models import CaptureAcknowledgement, CaptureCredential
from .grants import RETENTION


BATCH_SIZE = 100


def expired_candidates(model, cutoff, limit):
    return list(model.objects.filter(created_at__lt=cutoff).order_by("created_at", "pk")
                .values_list("pk", "workspace_id")[:limit])


def preserve_receipt(receipt, active_credentials):
    journal = receipt.inverse.get("journal")
    if journal:
        summary = journal_summary(receipt.created_at, journal)
        RestoredHistory.objects.create(workspace_id=receipt.workspace_id, occurred_at=summary["at"],
                                       action=summary["action"], item_ids=summary["items"])
    # Capture credentials can renew their context while retaining an operation
    # ID. Preserve their minimal acknowledgement only for the credential's life.
    if (receipt.context_id, receipt.workspace_id, receipt.actor_id) in active_credentials:
        CaptureAcknowledgement.objects.create(credential_id=receipt.context_id, operation_id=receipt.operation_id,
                                              item_id=receipt.result["selection"][0], fingerprint=receipt.fingerprint)


@transaction.atomic
def prune_batch(*, limit=BATCH_SIZE):
    if not 1 <= limit <= 1000:
        raise ValueError("Choose a retention batch size between 1 and 1000.")
    cutoff = timezone.now() - RETENTION
    receipts = expired_candidates(Receipt, cutoff, limit)
    changes = expired_candidates(Change, cutoff, limit)
    workspace_ids = {workspace for _, workspace in receipts + changes}
    locked = set(Workspace.objects.filter(pk__in=workspace_ids).order_by("pk")
                 .select_for_update(skip_locked=True).values_list("pk", flat=True))
    expired = Receipt.objects.filter(pk__in=[pk for pk, workspace in receipts if workspace in locked])
    active = set(CaptureCredential.objects.filter(pk__in=expired.values("context_id"))
                 .values_list("pk", "workspace_id", "user_id"))
    for receipt in expired.iterator(chunk_size=1):
        preserve_receipt(receipt, active)
    receipt_count, _ = expired.delete()
    change_count, _ = Change.objects.filter(pk__in=[pk for pk, workspace in changes if workspace in locked]).delete()
    return receipt_count, change_count
