"""Initial private workspaces, outline contents and durable command records."""
import uuid

from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="Workspace",
            fields=[
                ("id", models.UUIDField(primary_key=True, serialize=False, default=uuid.uuid4, editable=False)),
                ("revision", models.PositiveBigIntegerField(default=0)),
                ("generation", models.UUIDField(default=uuid.uuid4, editable=False)),
                ("private_owner", models.OneToOneField(settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE, related_name='private_workspace')),
            ],
        ),
        migrations.CreateModel(
            name="Membership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("user", models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)),
                ("role", models.CharField(max_length=12)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['workspace', 'user'], name='member_once'),
                    models.CheckConstraint(condition=models.Q(role__in=['owner', 'editor', 'viewer']), name='member_role'),
                ],
            },
        ),
        migrations.CreateModel(
            name="Tag",
            fields=[
                ("id", models.UUIDField(primary_key=True, serialize=False, default=uuid.uuid4, editable=False)),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("title", models.CharField(max_length=255)),
                ("version", models.PositiveBigIntegerField(default=1)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['workspace', 'id'], name='tag_scoped_id'),
                ],
            },
        ),
        migrations.CreateModel(
            name="Item",
            fields=[
                ("id", models.UUIDField(primary_key=True, serialize=False, default=uuid.uuid4, editable=False)),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("parent", models.ForeignKey("core.item", null=True, blank=True, related_name='children', on_delete=models.CASCADE)),
                ("kind", models.CharField(max_length=12)),
                ("title", models.CharField(max_length=255)),
                ("position", models.BigIntegerField()),
                ("done", models.BooleanField(default=False)),
                ("due", models.DateField(null=True, blank=True)),
                ("version", models.PositiveBigIntegerField(default=1)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['workspace', 'id'], name='item_scoped_id'),
                    models.CheckConstraint(condition=models.Q(kind__in=['project', 'group', 'action']), name='item_kind'),
                ],
                "indexes": [
                    models.Index(fields=['workspace', 'parent', 'position'], name='item_sibling_order'),
                ],
            },
        ),
        migrations.CreateModel(
            name="ItemTag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("item", models.ForeignKey("core.item", on_delete=models.CASCADE)),
                ("tag", models.ForeignKey("core.tag", on_delete=models.CASCADE)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['item', 'tag'], name='item_tag_once'),
                ],
            },
        ),
        migrations.CreateModel(
            name="Receipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("actor", models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)),
                ("context_id", models.UUIDField()),
                ("operation_id", models.UUIDField()),
                ("fingerprint", models.CharField(max_length=64)),
                ("result", models.JSONField()),
                ("inverse", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(default=timezone.now)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['workspace', 'actor', 'context_id', 'operation_id'], name='operation_once'),
                ],
            },
        ),
        migrations.CreateModel(
            name="Change",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("revision", models.PositiveBigIntegerField()),
                ("affected", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(default=timezone.now)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['workspace', 'revision'], name='change_once'),
                ],
            },
        ),
        migrations.CreateModel(
            name="Job",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("workspace", models.ForeignKey("core.workspace", on_delete=models.CASCADE)),
                ("actor", models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)),
                ("kind", models.CharField(max_length=64)),
                ("payload", models.JSONField(default=dict)),
                ("status", models.CharField(max_length=12, default='pending')),
                ("dedupe_key", models.CharField(max_length=200)),
                ("attempts", models.PositiveIntegerField(default=0)),
                ("next_attempt_at", models.DateTimeField(default=timezone.now)),
                ("lease_token", models.UUIDField(null=True)),
                ("lease_until", models.DateTimeField(null=True)),
                ("finished_at", models.DateTimeField(null=True)),
                ("last_error", models.CharField(max_length=64, default='')),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=['workspace', 'dedupe_key'], name='job_once'),
                ],
                "indexes": [
                    models.Index(fields=['status', 'next_attempt_at'], name='job_available'),
                ],
            },
        ),
        migrations.CreateModel(
            name="WorkerHeartbeat",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255, unique=True)),
                ("updated_at", models.DateTimeField(default=timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name="PasswordRecovery",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("user", models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)),
                ("digest", models.CharField(max_length=64, unique=True)),
                ("expires_at", models.DateTimeField()),
            ],
        ),
        migrations.CreateModel(
            name="LoginWindow",
            fields=[
                ("key", models.CharField(max_length=64, primary_key=True, serialize=False)),
                ("started_at", models.DateTimeField()),
                ("attempts", models.PositiveIntegerField(default=0)),
            ],
        ),
        migrations.AddField(
            model_name="item", name="tags",
            field=models.ManyToManyField(to="core.tag", through="core.ItemTag"),
        ),
    ]
