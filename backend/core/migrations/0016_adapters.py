from django.conf import settings
from django.db import migrations, models


def pk():
    return ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"))


def link(name, target):
    return (name, models.ForeignKey(on_delete=models.CASCADE, to=target))


def unique(name, *fields):
    return {"constraints": [models.UniqueConstraint(fields=fields, name=name)]}


class Migration(migrations.Migration):
    dependencies = [("core", "0015_sharing"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="CalendarConnection", fields=[
            pk(), link("workspace", "core.workspace"), link("user", settings.AUTH_USER_MODEL),
            ("source", models.CharField(max_length=80)), ("last_success", models.DateTimeField(null=True)),
            ("status", models.CharField(default="queued", max_length=40)),
        ], options=unique("calendar_subscription", "workspace", "user", "source")),
        migrations.CreateModel(name="CalendarEvent", fields=[
            pk(), link("connection", "core.calendarconnection"), ("key", models.CharField(max_length=64)),
            ("title", models.CharField(max_length=512)), ("start", models.CharField(max_length=40)),
            ("end", models.CharField(max_length=40)), ("all_day", models.BooleanField()),
        ], options=unique("calendar_event_identity", "connection", "key")),
        migrations.CreateModel(name="Reminder", fields=[
            pk(), ("public_id", models.UUIDField()), link("workspace", "core.workspace"),
            link("user", settings.AUTH_USER_MODEL), link("item", "core.item"), ("at", models.DateTimeField()),
            ("status", models.CharField(default="scheduled", max_length=16)),
        ], options=unique("personal_reminder_id", "workspace", "user", "public_id")),
        migrations.CreateModel(name="PushDevice", fields=[
            pk(), link("user", settings.AUTH_USER_MODEL), ("device", models.UUIDField()),
            ("endpoint", models.TextField()), ("endpoint_digest", models.CharField(max_length=64, unique=True, null=True)),
            ("enabled", models.BooleanField(default=True)),
        ], options=unique("personal_push_device", "user", "device")),
        migrations.CreateModel(name="ReminderDelivery", fields=[
            pk(), link("reminder", "core.reminder"), link("device", "core.pushdevice"),
            ("status", models.CharField(default="pending", max_length=24)),
        ], options=unique("one_reminder_delivery", "reminder", "device")),
        migrations.CreateModel(name="TagPlace", fields=[
            ("tag", models.OneToOneField(primary_key=True, serialize=False, on_delete=models.CASCADE, to="core.tag")),
            ("latitude", models.FloatField()), ("longitude", models.FloatField()),
            ("radius_meters", models.PositiveIntegerField()),
        ]),
    ]
