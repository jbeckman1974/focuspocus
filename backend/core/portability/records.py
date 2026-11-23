"""Explicit workspace record schema and data extraction."""
from dataclasses import dataclass
from heapq import merge
from operator import itemgetter

from django.db.models import Count, F
from core.content.models import AttachmentBlob, AttachmentBody, AttachmentLink, ItemNote
from core.imports.portable import iter_export_batches
from core.integrations.portable import export_settings
from core.models import Item, ItemTag, Membership, Occurrence, ProjectReview, Receipt, RepeatSeries, Tag

from .archive import MAX_RECORD_BYTES, encoded
from .models import RestoredHistory, RestoredReviewer
from .personal import personal_settings


@dataclass(frozen=True)
class Table:
    name: str
    model: type
    columns: str
    # ID references are interpreted only in these columns, never in user-authored text.
    references: tuple = ()

    def fields(self):
        return self.columns.split()


TABLES = (
    Table("tags", Tag, "id title status version parent_id exclusive", (("parent_id", "tags"),)),
    Table("items", Item,
          "id parent_id kind title position done disposition mode auto_complete flagged in_progress created_at changed_at "
          "completed_at dropped_at due schedule duration_minutes version shelf shelf_root shelf_before filing_project_id is_miscellaneous",
          (("parent_id", "items"), ("filing_project_id", "items"), ("shelf_root", "items"), ("shelf_before", "items"))),
    Table("itemTags", ItemTag, "item_id tag_id", (("item_id", "items"), ("tag_id", "tags"))),
    Table("series", RepeatSeries, "id rule origin remaining version active"),
    Table("occurrences", Occurrence, "id item_id series_id predecessor_id outcome resolved_at applied_rule",
          (("item_id", "items"), ("series_id", "series"), ("predecessor_id", "occurrences"))),
    Table("reviews", ProjectReview, "project_id interval unit next_review last_reviewed_at version", (("project_id", "items"),)),
    Table("notes", ItemNote, "id item_id document", (("item_id", "items"),)),
    Table("blobs", AttachmentBlob, "id sha256 size media_type created_at"),
    Table("files", AttachmentLink, "id item_id blob_id filename", (("item_id", "items"), ("blob_id", "blobs"))),
)


def journal_summary(stamp, journal):
    items = [row["id"] for row in journal.get("rows", []) if row.get("model") == "item"]
    return {"at": stamp, "action": journal["command"], "items": items}


def history_rows(workspace):
    saved = RestoredHistory.objects.filter(workspace=workspace).order_by("occurred_at", "pk")
    summaries = ({"at": row.occurred_at, "action": row.action, "items": row.item_ids} for row in saved.iterator())
    shared = (Receipt.objects.filter(workspace=workspace, inverse__journal__isnull=False)
              .order_by("created_at", "pk").values_list("created_at", "inverse__journal"))
    current = (journal_summary(stamp, journal) for stamp, journal in shared.iterator())
    yield from merge(summaries, current, key=itemgetter("at"))


def review_sources(workspace):
    origins = dict(RestoredReviewer.objects.filter(
        project__workspace=workspace, project__projectreview__last_reviewed_at=F("reviewed_at"),
    ).values_list("project_id", "source_label"))
    live = ProjectReview.objects.filter(workspace=workspace, last_actor__isnull=False, last_reviewed_at__isnull=False)
    for project, actor in live.values_list("project_id", "last_actor_id"):
        origins[project] = f"member:{actor}"
    return [{"project": str(project), "reviewer": label} for project, label in origins.items()]


def export_records(workspace, actor, include_personal):
    from core.sharing.models import SharedWorkspace

    label = SharedWorkspace.objects.filter(workspace=workspace).values_list("name", flat=True).first()
    adapters = export_settings(workspace, actor if include_personal else None)
    records = {
        "workspace": {"name": label or "Restored workspace", "timeZone": workspace.time_zone,
                      "dateDefaults": workspace.date_defaults, "filingPolicy": workspace.filing_policy},
        "memberships": list(Membership.objects.filter(workspace=workspace).values("role").annotate(count=Count("pk")).order_by("role")),
        "places": adapters["places"],
        "reviewSources": review_sources(workspace),
        "personal": personal_settings(workspace, actor, adapters) if include_personal else None,
    }
    record_bytes = len(encoded(records))

    def collect(rows):
        nonlocal record_bytes
        result = []
        for row in rows:
            record_bytes += len(encoded(row)) + 1
            if record_bytes > MAX_RECORD_BYTES or len(result) >= 200_000:
                raise ValueError("Workspace records exceed the bundle limit.")
            result.append(row)
        return result

    records["history"] = collect(history_rows(workspace))
    records["imports"] = collect(iter_export_batches(workspace))
    linked = AttachmentLink.objects.filter(workspace=workspace).values("blob_id")
    for table in TABLES:
        data = table.model.objects.filter(workspace=workspace)
        if table.model is AttachmentBlob:
            data = data.filter(pk__in=linked)
        records[table.name] = collect(data.order_by("pk").values(*table.fields()).iterator(chunk_size=64))
    bodies = AttachmentBody.objects.filter(blob__workspace=workspace, blob_id__in=linked).order_by("pk")
    return records, bodies.values_list("blob__sha256", "blob__size", "data").iterator(chunk_size=1)
