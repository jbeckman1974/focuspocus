import http.client
from datetime import date, datetime, timedelta
from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from core.access import locked_membership
from core.commands.validation import CommandError, fields
from core.models import Job

from . import ical, transport
from .configuration import AdapterError, sources
from .models import CalendarConnection, CalendarEvent


CALENDAR = "calendar-refresh"


def queue(connection, at):
    job = Job.objects.filter(workspace=connection.workspace, actor=connection.user, kind=CALENDAR,
                             payload={"connection": connection.pk}, status__in=["pending", "running"]).first()
    if job:
        if job.status == "pending" and job.next_attempt_at > at:
            Job.objects.filter(pk=job.pk, status="pending").update(next_attempt_at=at)
        return
    new_job(connection, at)


def new_job(connection, at, predecessor=None):
    Job.objects.get_or_create(workspace=connection.workspace,
                              dedupe_key=f"calendar:{connection.pk}:{predecessor or uuid4()}",
                              defaults={"actor": connection.user, "kind": CALENDAR,
                                        "payload": {"connection": connection.pk}, "next_attempt_at": at})


def calendars(workspace, user, body=None):
    available = sources(user)
    personal = CalendarConnection.objects.filter(workspace=workspace, user=user)
    if body is not None:
        fields(body, ["action", "source"])
        source, action = body["source"], body["action"]
        if not isinstance(source, str) or not 0 < len(source) <= 80:
            raise CommandError("Invalid source.")
        if action == "disconnect":
            personal.filter(source=source).delete()
        elif action in ("connect", "refresh"):
            if source not in available:
                raise CommandError("Calendar source unavailable.", 404)
            if action == "connect":
                connection = personal.get_or_create(source=source)[0]
            else:
                connection = personal.filter(source=source).first()
                if connection is None or connection.status == "disconnected":
                    raise CommandError("Connect this calendar first.", 409)
            connection.status = "queued"
            connection.save(update_fields=["status"])
            queue(connection, timezone.now())
        else:
            raise CommandError("Unknown calendar action.")
    return {"sources": [{"key": key, "label": val["label"]} for key, val in sorted(available.items())],
            "connections": [{"source": c.source, "label": available.get(c.source, {}).get("label", c.source),
                             "status": c.status if c.source in available else "source_unavailable",
                             "lastSuccess": c.last_success.isoformat() if c.last_success else None}
                            for c in personal.order_by("source")]}


def connection_for(job):
    return CalendarConnection.objects.filter(pk=job.payload.get("connection"), workspace_id=job.workspace_id,
                                             user_id=job.actor_id).select_related("workspace", "user").first()


def refresh(job):
    with transaction.atomic():
        space, _ = locked_membership(job.actor, job.workspace_id)
        connection = connection_for(job) if space and job.actor.is_active else None
        if connection is None or connection.status == "disconnected":
            return "authorization_revoked"
    events, error = None, ""
    try:
        config = sources(connection.user).get(connection.source)
        if not config:
            raise AdapterError("source_unavailable")
        status, raw = transport.transaction("GET", config["url"], headers={"Accept": "text/calendar"})
        if status in (401, 403):
            raise AdapterError("calendar_access_expired")
        if status != 200:
            raise AdapterError("calendar_refresh_failed")
        events = ical.parse(raw, space.time_zone)
    except AdapterError as exc:
        error = str(exc)
    except (OSError, http.client.HTTPException):
        error = "calendar_refresh_failed"
    with transaction.atomic():
        space, _ = locked_membership(job.actor, job.workspace_id)
        connection = connection_for(job) if space and job.actor.is_active else None
        if connection is None or connection.status == "disconnected":
            return "authorization_revoked"
        if not Job.objects.select_for_update().filter(pk=job.pk, status="running", lease_token=job.lease_token,
                                                 lease_until__gt=timezone.now()).exists():
            return "lease_lost"
        now = timezone.now()
        if not error:
            CalendarEvent.objects.filter(connection=connection).delete()
            CalendarEvent.objects.bulk_create(CalendarEvent(connection=connection, **event) for event in events)
            connection.last_success = now
        elif error in ("source_unavailable", "calendar_access_expired"):
            CalendarEvent.objects.filter(connection=connection).delete()
        connection.status = error or "ready"
        connection.save(update_fields=["status", "last_success"])
        # A stopped or revoked connection needs explicit reconnection. Ordinary transport failure
        # leaves the last successful snapshot visible and a future refresh scheduled.
        if error not in ("source_unavailable", "calendar_access_expired"):
            new_job(connection, now + timedelta(hours=1), predecessor=job.pk)
    return error


def add_to_forecast(days, workspace, user, zone):
    indexed = {row["date"]: row.setdefault("events", []) for row in days}
    try:
        allowed = sources(user)
    except AdapterError:
        return
    if not allowed:
        return
    events = CalendarEvent.objects.filter(connection__workspace=workspace, connection__user=user,
                                          connection__source__in=allowed).exclude(
        connection__status__in=("disconnected", "source_unavailable", "calendar_access_expired")
    ).select_related("connection").order_by("start", "key")
    for event in events:
        if event.all_day:
            first = date.fromisoformat(event.start)
            last = date.fromisoformat(event.end) - timedelta(days=1)
        else:
            start, end = datetime.fromisoformat(event.start), datetime.fromisoformat(event.end)
            first = start.astimezone(zone).date()
            last = (end - timedelta(microseconds=1) if end > start else start).astimezone(zone).date()
        if first.isoformat() > days[-1]["date"] or last.isoformat() < days[0]["date"]:
            continue
        entry = {"id": f"calendar:{event.connection_id}:{event.key}", "title": event.title,
                 "source": allowed[event.connection.source]["label"], "allDay": event.all_day,
                 "start": event.start, "end": event.end}
        for day, target in indexed.items():
            if first.isoformat() <= day <= last.isoformat():
                target.append(entry)
