"""Record domain rows changed by one command while the workspace lock is held."""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
from uuid import UUID

from django.db.models.signals import post_save, pre_delete, pre_save

from core.commands.validation import CommandError
from core.models import Item, ItemTag, Occurrence, Receipt, RepeatSeries, Tag


MODELS = {model._meta.model_name: model for model in (Item, Tag, ItemTag, RepeatSeries, Occurrence)}
_active = ContextVar("focuspocus_command_history", default=None)


def key(obj):
    return (obj._meta.model_name, str(obj.pk))


def row_values(obj):
    values = {}
    for field in obj._meta.concrete_fields:
        if field.primary_key or field.name == "workspace":
            continue
        value = field.value_from_object(obj)
        if isinstance(value, UUID):
            value = str(value)
        elif isinstance(value, date):
            value = value.isoformat()
        values[field.attname] = value
    return values


def cursor(workspace):
    latest = (Receipt.objects.filter(workspace=workspace, result__revision=workspace.revision,
                                     inverse__journal__isnull=False)
              .order_by("-created_at", "-pk").values_list("inverse", flat=True).first())
    if latest and latest["journal"]["generation"] == str(workspace.generation):
        return latest["journal"]["end"]
    return f"{workspace.generation}.{workspace.revision}"


class Recording:
    def __init__(self, workspace):
        self.workspace = workspace
        self.initial = cursor(workspace)
        self.destination = None
        self.before = {}
        self.allowed_deletions = None

    def original(self, obj):
        if obj.workspace_id != self.workspace.pk:
            raise CommandError("An edit refers to a different workspace.", 409)
        identity = key(obj)
        if identity not in self.before:
            original = type(obj).objects.filter(workspace=self.workspace, pk=obj.pk).first()
            self.before[identity] = row_values(original) if original else None

    def created(self, obj):
        if obj.workspace_id != self.workspace.pk:
            raise CommandError("An edit refers to a different workspace.", 409)
        self.before.setdefault(key(obj), None)

    def finish(self, name):
        delta = []
        for model_name, model in MODELS.items():
            ids = [pk for kind, pk in self.before if kind == model_name]
            if not ids:
                continue
            final = {str(pk): row_values(row) for pk, row in
                     model.objects.filter(workspace=self.workspace).in_bulk(ids).items()}
            for pk in ids:
                before, after = self.before[(model_name, pk)], final.get(pk)
                if before != after:
                    delta.append({"model": model_name, "id": pk, "before": before, "after": after})
        if not delta:
            return {}
        return {"journal": {"schema": 1, "command": name, "generation": str(self.workspace.generation),
                            "start": self.initial, "end": self.destination or
                            f"{self.workspace.generation}.{self.workspace.revision + 1}", "rows": delta}}


@contextmanager
def recording(workspace):
    frame = Recording(workspace)
    token = _active.set(frame)
    try:
        yield frame
    finally:
        _active.reset(token)


def current():
    return _active.get()


def before_save(sender, instance, **kwargs):
    frame = current()
    if frame is not None and not instance._state.adding:
        frame.original(instance)


def after_save(sender, instance, created, **kwargs):
    if created and current() is not None:
        current().created(instance)


def before_delete(sender, instance, **kwargs):
    frame = current()
    if frame is None:
        return
    if frame.allowed_deletions is not None and key(instance) not in frame.allowed_deletions:
        raise CommandError("A dependent record has changed since this edit.", 409)
    frame.original(instance)


def register():
    for name, model in MODELS.items():
        for signal, receiver in ((pre_save, before_save), (post_save, after_save), (pre_delete, before_delete)):
            signal.connect(receiver, sender=model, dispatch_uid=f"core.history.{name}.{receiver.__name__}")


def create_many(model, objects):
    created = model.objects.bulk_create(objects)
    frame = current()
    if frame is not None:
        for obj in created:
            frame.created(obj)
    return created
