from datetime import datetime
from datetime import timezone as utc

from django.utils import timezone

from core.commands.validation import CommandError, fields, identifier
from core.models import Item, Job

from . import push
from .models import Reminder, ReminderDelivery


DUE = "reminder-due"
PUSH = "reminder-push"


def timestamp(value):
    try:
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if not instant.tzinfo:
            raise ValueError
        return instant.astimezone(utc.utc)
    except (ValueError, OverflowError) as exc:
        raise CommandError("Supply a reminder time with a UTC offset.") from exc


def enqueue(reminder):
    Job.objects.get_or_create(workspace=reminder.workspace,
                              dedupe_key=f"reminder:{reminder.pk}:{reminder.workspace.generation}",
                              defaults={"actor": reminder.user, "kind": DUE, "payload": {"reminder": reminder.pk},
                                        "next_attempt_at": reminder.at})


def mutate(workspace, user, body):
    collection = Reminder.objects.filter(workspace=workspace, user=user)
    if "action" in body:
        fields(body, ["id", "action"])
        reminder = collection.filter(public_id=identifier(body["id"])).first()
        if reminder is None:
            raise CommandError("Reminder unavailable.", 404)
        if body["action"] == "cancel":
            reminder.status = "cancelled"
        elif body["action"] == "resume" and reminder.status == "paused":
            reminder.status = "scheduled"
            enqueue(reminder)
        else:
            raise CommandError("This reminder cannot make that change.", 409)
        reminder.save(update_fields=["status"])
        return
    fields(body, ["id", "itemId", "at"])
    public_id, item_id = identifier(body["id"]), identifier(body["itemId"])
    at = timestamp(body["at"])
    item = Item.objects.filter(workspace=workspace, pk=item_id, shelf="active").first()
    if item is None:
        raise CommandError("Item unavailable.", 404)
    prior = collection.filter(public_id=public_id).first()
    if prior:
        if prior.item_id != item_id or prior.at != at:
            raise CommandError("This reminder ID was already used.", 409)
        return
    if collection.filter(status="scheduled").count() >= 2000:
        raise CommandError("Cancel an upcoming reminder before creating another.", 409)
    reminder = Reminder.objects.create(workspace=workspace, user=user, public_id=public_id, item=item, at=at)
    enqueue(reminder)


def reminder_list(workspace, user, body=None):
    if body is not None:
        if not isinstance(body, dict):
            raise CommandError("Send a reminder object.")
        mutate(workspace, user, body)
    rows = Reminder.objects.filter(workspace=workspace, user=user, item__workspace=workspace,
                                   item__shelf="active").prefetch_related("reminderdelivery_set").order_by("at", "pk")
    result = []
    for row in rows:
        attempts = {a.status for a in row.reminderdelivery_set.all()}
        state = next((s for s in ("uncertain", "failed", "expired", "pending", "sending", "sent")
                      if s in attempts), "in_app")
        result.append({"id": str(row.public_id), "itemId": str(row.item_id), "at": row.at.isoformat(),
                       "status": row.status, "delivery": "pending" if state == "sending" else state})
    return {"reminders": result, "pushPublicKey": push.public_key()}
