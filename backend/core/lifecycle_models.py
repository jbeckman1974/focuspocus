"""Persistent tree placement, recoverable subtrees and Inbox filing preferences."""

from django.conf import settings
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


class OrganizationPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, primary_key=True, on_delete=models.CASCADE)
    resolved_cleanup = models.CharField(default="on-cleanup", max_length=12)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(resolved_cleanup__in=["immediate", "on-cleanup"]),
                                   name="cleanup_mode"),
        ]
