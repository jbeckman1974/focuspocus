"""Exercise workspace projections at a size that exposes query-per-item and ID-list expansions."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from django.db import connection
from django.test import TestCase

from core.content.models import ItemNote
from core.content.search import note_matches
from core.models import Item, ItemTag, Tag, Workspace
from core.queries.records import read_records
from core.scheduling.dates import DateContext


class ProjectionQueryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.space = Workspace.objects.create()
        foreign = Workspace.objects.create()
        parent = Item.objects.create(workspace=cls.space, kind="project", title="Work", position=1,
                                     mode="sequential", schedule={"defer": {"kind": "date", "value": "2026-11-24"}})
        cls.actions = Item.objects.bulk_create([
            Item(workspace=cls.space, parent=parent, kind="action", position=n, title=f"Task {n}")
            for n in range(300)
        ])
        cls.parent = str(parent.pk)
        early, late = (Tag.objects.create(workspace=cls.space, id=UUID(int=n), title=label, status="held")
                       for n, label in [(2, "A"), (1, "Z")])
        for tag in (late, early):
            ItemTag.objects.create(workspace=cls.space, item=cls.actions[0], tag=tag)
        cls.held_tags = [str(early.pk), str(late.pk)]
        archived_id = uuid4()
        archived = Item.objects.create(workspace=cls.space, id=archived_id, kind="action", shelf="archive",
                                       shelf_root=archived_id, position=1, title="Filed")
        outsider = Item.objects.create(workspace=foreign, kind="action", position=1, title="Unrelated")
        for item in [*cls.actions[:2], archived, outsider]:
            ItemNote.objects.create(workspace_id=item.workspace_id, item=item, document={}, plain_text="Note token")

    def test_projection_query_shape_is_independent_of_item_count(self):
        parameter_counts = []

        def count_parameters(execute, sql, params, many, context):
            parameter_counts.append(len(params or ()))
            return execute(sql, params, many, context)

        clock = DateContext("UTC", datetime(2026, 11, 21, tzinfo=timezone.utc))
        with connection.execute_wrapper(count_parameters):
            rows, tags, meta = read_records(self.space, clock=clock)
        self.assertLessEqual(len(parameter_counts), 6)
        self.assertLessEqual(max(parameter_counts), 8)
        self.assertEqual(len(rows), 301)
        first = next(row for row in rows if row["id"] == str(self.actions[0].pk))
        self.assertEqual(first["tags"], self.held_tags)
        self.assertEqual([tag["id"] for tag in tags], self.held_tags)
        self.assertEqual(first["effective"]["reasonSource"], min(self.held_tags))
        self.assertEqual(first["effective"]["schedule"]["defer"]["source"], self.parent)
        self.assertEqual(meta["nextDateBoundary"], "2026-11-24T00:00:00+00:00")

    def test_note_search_scopes_and_empty_selection(self):
        one, two = [str(item.pk) for item in self.actions[:2]]
        with self.assertNumQueries(1):
            self.assertEqual(note_matches(self.space, ["token"]), {"token": {one, two}})
        self.assertEqual(note_matches(self.space, ["absent", "token"], item_ids=[one]), {"absent": set(), "token": {one}})
        with self.assertNumQueries(0):
            self.assertEqual(note_matches(self.space, ["token"], item_ids=[]), {"token": set()})
