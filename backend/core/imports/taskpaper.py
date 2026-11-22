"""Read ordered TaskPaper items, parameters and indented plain notes."""

import re

from core.commands.validation import CommandError

from .source import MAX_ISSUES, MAX_ROWS, issue, row


PARAMETER = re.compile(r"(?<!\S)@([\w-]+)(?:\(((?:\\.|[^()\\])*)\))?(?=\s|$)")


def read(text):
    rows, issues, stack = [], [], []
    for number, content in enumerate(text.split("\n"), 1):
        if not content.strip():
            if rows and rows[-1]["notes"]:
                rows[-1]["notes"].append("")
            continue
        line = content.lstrip(" \t")
        indent = len(content[:len(content) - len(line)].expandtabs(4))
        parameters = {}
        def consume(match):
            key, value = match.groups()
            if key in parameters:
                issues.append(issue(number, key, "ambiguous", "Repeated parameter; the final value is used."))
            parameters[key] = re.sub(r"\\([()\\])", r"\1", value) if value is not None else ""
            return ""
        name = PARAMETER.sub(consume, line).strip()
        if not (name.startswith("- ") or name.endswith(":")):
            parent = next((item for width, item in reversed(stack) if width <= indent), None)
            if parent:
                parent["notes"].append(line)
            else:
                issues.append(issue(number, "note", "unsupported", "This line has no preceding item."))
            continue
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else None
        kind = "action" if name.startswith("- ") else "project"
        if parent and parent["kind"] == "action":
            parent["kind"] = "group"
        if parent and kind == "project" and parent["kind"] != "folder":
            issues.append(issue(number, "kind", "transformed", "A nested project heading is represented as a group."))
            kind = "group"
        item = row(number, name[2:].strip() if name.startswith("- ") else name[:-1].strip(), kind,
                   parent["line"] if parent else None, parameters.pop("id", ""))
        item["rawFields"] = parameters
        rows.append(item)
        stack.append((indent, item))
        if len(rows) > MAX_ROWS or len(issues) > MAX_ISSUES:
            raise CommandError("Too many rows or diagnostics in one import.", 413)
    for item in rows:
        while item["notes"] and item["notes"][-1] == "":
            item["notes"].pop()
    return rows, issues
