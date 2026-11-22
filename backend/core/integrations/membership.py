from django.utils import timezone

from core.models import Job

from .calendars import CALENDAR
from .models import CalendarConnection, PushDevice, Reminder, ReminderDelivery
from .reminders import DUE, PUSH


def revoke_personal(workspace, user):
    CalendarConnection.objects.filter(workspace=workspace, user=user).delete()
    rows = Reminder.objects.filter(workspace=workspace, user=user)
    ReminderDelivery.objects.filter(reminder__in=rows, status="sending").update(status="uncertain")
    ReminderDelivery.objects.filter(reminder__in=rows, status="pending").update(status="cancelled")
    rows.filter(status__in=("due", "scheduled")).update(status="cancelled")
    Job.objects.filter(workspace=workspace, actor=user, kind__in=(DUE, PUSH, CALENDAR),
                       status__in=("pending", "running")).update(
        status="failed", last_error="authorization_revoked", finished_at=timezone.now(),
        lease_until=None, lease_token=None)


def hold_after_restore():
    """Credentials and remembered permissions may predate a revocation."""
    CalendarConnection.objects.update(status="disconnected")
    PushDevice.objects.update(enabled=False)
    Reminder.objects.filter(status__in=("scheduled", "due")).update(status="paused")
    ReminderDelivery.objects.filter(status="sending").update(status="uncertain")
    ReminderDelivery.objects.filter(status="pending").update(status="cancelled")
