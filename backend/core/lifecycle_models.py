"""Persistent tree placement, recoverable subtrees and Inbox filing preferences."""

from django.db import models


class WorkspaceFilingFields(models.Model):
    filing_policy = models.CharField(max_length=8, default="project")

    class Meta:
        abstract = True


class TagTreeFields(models.Model):
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="child_tags")
    exclusive = models.BooleanField(default=False)

    class Meta:
        abstract = True


class ItemLifecycleFields(models.Model):
    shelf = models.CharField(max_length=8, default="active")
    shelf_root = models.UUIDField(null=True, blank=True)
    shelf_before = models.UUIDField(null=True, blank=True)
    filing_project = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_miscellaneous = models.BooleanField(default=False)

    class Meta:
        abstract = True
