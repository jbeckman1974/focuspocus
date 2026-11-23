"""Populate only a new local benchmark account and verify the fixture in PostgreSQL."""

from argparse import ArgumentParser
from datetime import timedelta
from itertools import islice
import json
import os
import secrets
from uuid import uuid5

import django


def expected_viewports(actions, groups):
    """Independent manual-order prefixes, including structural context in Flagged."""
    def flagged_rows():
        previous = None
        for n in range(7, len(actions) + 1, 7):
            group = groups[(n - 1) // 10]
            if group.pk != previous:
                yield group
                previous = group.pk
            yield actions[n - 1]

    def first_page(rows):
        return [{"id": str(row.pk), "title": row.title} for row in islice(rows, 100)]

    return {"flagged": first_page(flagged_rows()), "completed": first_page(actions[12::13]),
            "bench": first_page(actions[22::23]), "ledger": first_page(actions[45::46])}


def seed(*, browser_benchmark=False):
    from django.db import connection, transaction
    from django.utils import timezone

    from core.auth_services import provision_account
    from core.content.notes import validate_document
    from core.models import Item, ItemNote, ItemTag, Tag

    if os.environ.get("APP_ENV") != "development" or connection.vendor != "postgresql":
        raise ValueError("A disposable development PostgreSQL database is required.")
    owner = {"username": "qa_" + secrets.token_hex(10), "password": secrets.token_urlsafe(32)}
    now = timezone.now()
    today = now.date()
    tomorrow = (today + timedelta(days=1)).isoformat()
    with transaction.atomic():
        workspace = provision_account(**owner).private_workspace
        items = Item.objects.filter(workspace=workspace)
        if items.exists():
            raise ValueError("The new account already contains data.")
        tag = Tag.objects.create(workspace=workspace, title="Waiting", status="held")

        def item(kind, ordinal, parent_id, position, **fields):
            return Item(id=uuid5(workspace.id, f"{kind}-{ordinal}"), workspace=workspace,
                        parent_id=parent_id, kind=kind, title=f"{kind.capitalize()} {ordinal:05}",
                        position=position, created_at=now, changed_at=now, **fields)

        projects, groups, actions, links, notes = [], [], [], [], []
        for p in range(100):
            project = item("project", p + 1, None, p + 1, mode="sequential" if p % 2 == 0 else "parallel")
            projects.append(project)
            for g in range(10):
                group = item("group", 10*p + g + 1, project.id, g + 1, mode="parallel")
                groups.append(group)
                for a in range(10):
                    n = 100*p + 10*g + a + 1
                    action = item("action", n, group.id, a + 1, flagged=n % 7 == 0, done=n % 13 == 0,
                                  completed_at=now if n % 13 == 0 else None, due=today if n % 17 == 0 else None,
                                  schedule={"defer": {"kind": "date", "value": tomorrow}} if n % 5 == 0 else {})
                    actions.append(action)
                    if n % 11 == 0:
                        links.append(ItemTag(workspace=workspace, item=action, tag=tag))
                    if n % 23 == 0:
                        text = "Field bench ledger" if n % 46 == 0 else "Field bench"
                        document, plain = validate_document({"paragraphs": [[{"text": text}]]})
                        notes.append(ItemNote(item=action, workspace=workspace, document=document, plain_text=plain))
        if browser_benchmark:
            # Each proper prefix matches this extra note; neither final token does.
            document, plain = validate_document({"paragraphs": [[{"text": "benc ledge"}]]})
            notes.append(ItemNote(item=actions[0], workspace=workspace, document=document, plain_text=plain))
        for level in (projects, groups, actions):
            Item.objects.bulk_create(level, batch_size=300)
        ItemTag.objects.bulk_create(links)
        ItemNote.objects.bulk_create(notes)

        sql_notes = ItemNote.objects.filter(workspace=workspace)
        stats = dict(
            projects=items.filter(kind="project").count(), groups=items.filter(kind="group").count(),
            actions=items.filter(kind="action").count(), sequential=items.filter(mode="sequential").count(),
            deferred=items.filter(schedule__defer__value=tomorrow).count(), flagged=items.filter(flagged=True).count(),
            held=items.filter(tags__status="held").count(), completed=items.filter(done=True).count(),
            due=items.filter(due=today).count(), bench=sql_notes.filter(plain_text__icontains="bench").count(),
            ledger=sql_notes.filter(plain_text__icontains="ledger").count(),
            deferredFlagged=items.filter(flagged=True, schedule__defer__value=tomorrow).count(),
        )
        expected = dict(projects=100, groups=1000, actions=10000, sequential=50, deferred=2000,
                        flagged=1428, held=909, completed=769, due=588, bench=434, ledger=217, deferredFlagged=285)
        if browser_benchmark:
            stats.update(benc=sql_notes.filter(plain_text__icontains="benc").count(),
                         ledge=sql_notes.filter(plain_text__icontains="ledge").count())
            expected.update(benc=435, ledge=218)
        if stats != expected:
            raise ValueError(f"SQL fixture verification failed: {stats}")
    payload = {"owner": owner, "fixture": {**stats, "utcDay": today.isoformat()}}
    if browser_benchmark:
        payload["expectedRows"] = expected_viewports(actions, groups)
    return payload


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--browser-benchmark", action="store_true")
    args = parser.parse_args()
    django.setup()
    # stdout is redirected straight into the run's private account mount.
    print(json.dumps(seed(browser_benchmark=args.browser_benchmark)))
