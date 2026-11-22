from datetime import datetime, timezone
from unittest import TestCase

from core.commands.validation import CommandError
from core.imports.parser import parse
from core.scheduling.dates import DateContext


class ImportParserTests(TestCase):
    clock = DateContext("America/New_York", datetime(2026, 10, 10, tzinfo=timezone.utc))

    def test_unicode_csv_hierarchy_dates_and_multiline_notes(self):
        data = 'ID,Parent ID,Type,Name,Note,Due Date,Attachments\n2,1,Task,β,"Café,\nsecond",2026-11-22,path.png\n1,,Project,Start,,,\n'
        result = parse(data.encode("utf-16"), "csv", self.clock)
        project, task = result["rows"]
        self.assertEqual(task["parentLine"], project["line"])
        self.assertEqual(task["fields"]["note"], "Café,\nsecond")
        self.assertEqual(task["fields"]["schedule"]["due"]["defaultTime"], "17:00")
        self.assertTrue(any(i["field"] == "attachments" and i["line"] == 2 for i in result["issues"]))
        self.assertEqual(result["encoding"], "utf-16")

    def test_taskpaper_parameters_hierarchy_and_timed_repeats(self):
        result = parse("Week: @parallel(false)\n\t- Group\n\t\t- Café @tags(Field, Desk) @flagged @due(2026-11-22) @repeat-rule(FREQ=WEEKLY;INTERVAL=2)\n\t\t\tNotes β\n".encode(), "taskpaper", self.clock)
        project, group, task = result["rows"]
        self.assertEqual(project["fields"]["mode"], "sequential")
        self.assertEqual(group["kind"], "group")
        self.assertEqual(task["parentLine"], group["line"])
        self.assertEqual(task["fields"]["repeat"]["interval"], 2)
        self.assertEqual([s["due"]["value"] for s in task["fields"]["successorsIfCompletedOnSchedule"]],
                         ["2026-12-06", "2026-12-20", "2027-01-03"])
        self.assertEqual(task["fields"]["tags"], ["Field", "Desk"])
        self.assertEqual(task["fields"]["note"], "Notes β")
        self.assertFalse(any(i["category"] == "invalid" for i in result["issues"]))

    def test_duplicate_titles_are_distinct_and_unknown_fields_are_disclosed(self):
        data = b"- Same @placed(Mars)\n- Same @due(next friday)"
        rows = parse(data, "taskpaper", self.clock)
        self.assertNotEqual(rows["rows"][0]["key"], rows["rows"][1]["key"])
        self.assertEqual(rows, parse(data, "taskpaper", self.clock))
        self.assertEqual({i["field"] for i in rows["issues"] if i["category"] == "unsupported"}, {"placed", "due"})

    def test_invalid_input_never_appears_ready(self):
        for text in ('Name,Title\na,a', 'Name,ID,Parent ID\na,1,2\nb,2,1',
                     'Name,ID\na,1\nb,1', 'Name,Note\na,"unterminated', 'Name,Note\na,b,c'):
            with self.subTest(text=text):
                self.assertTrue(any(i["category"] == "invalid" for i in parse(text.encode(), "csv", self.clock)["issues"]))
        with self.assertRaises(CommandError):
            parse(b"\x81\x00", "csv", self.clock)

    def test_local_meridiem_and_file_scoped_outline_numbering(self):
        csv = "Task ID\tPersistent ID\tType\tName\tDue\n1\tproject\tProject\tPlan\t\n1.1\t\tTask\tRead\t2026-04-19 5pm\n"
        result = parse(csv.encode("utf-16"), "csv", self.clock)
        project, task = result["rows"]
        self.assertEqual(task["parentLine"], project["line"])
        self.assertEqual(task["fields"]["schedule"]["due"], {"kind": "floating", "value": "2026-04-19T17:00"})
        self.assertEqual(task["sourceId"], "")
