"""Evaluate workspace availability in manual tree order with an explicit clock."""

from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Optional


@dataclass(frozen=True)
class Node:
    id: str
    parent_id: Optional[str]
    kind: str
    position: int
    mode: Optional[str] = None
    status: str = "active"
    flagged: bool = False
    held_tag: Optional[str] = None
    defer_until: Optional[datetime] = None


@dataclass(frozen=True)
class Result:
    status: str
    status_source: str
    flagged: bool
    flag_source: Optional[str]
    remaining: bool
    available: bool
    first_available: bool
    blocked: bool
    reason: Optional[str]
    reason_source: Optional[str]


@dataclass(frozen=True)
class Context:
    resolved: Optional[tuple] = None
    flag_source: Optional[str] = None
    barrier: Optional[tuple] = None
    # The same project competes for a first action across nested groups.
    first_pool: Optional[str] = None
    defer: Optional[tuple] = None


RESOLVED = {"completed", "dropped"}


def evaluate_node(node, parent, now, chosen):
    resolved = parent.resolved
    if node.status in RESOLVED:
        resolved = (node.status, node.id)
    status, status_source = resolved or (node.status, node.id)
    flag_source = node.id if node.flagged else parent.flag_source
    defer = parent.defer
    if node.defer_until is not None and (defer is None or node.defer_until >= defer[0]):
        defer = (node.defer_until, node.id)
    barrier = parent.barrier
    if barrier is None:
        if node.status == "held":
            barrier = ("On hold", node.id)
        elif node.kind in ("action", "group") and node.held_tag:
            barrier = ("On-hold tag", node.held_tag)
    current_barrier = barrier
    if current_barrier is None and defer is not None and now < defer[0]:
        current_barrier = ("Deferred", defer[1])
    remaining = resolved is None
    available = remaining and current_barrier is None
    first_pool = parent.first_pool
    if node.kind == "project":
        first_pool = None if node.mode == "single-action" else node.id
    elif node.kind == "group" and node.parent_id is None:
        # A top-level Inbox group has its own first action.
        first_pool = node.id
    first = node.kind == "action" and available and (first_pool is None or first_pool not in chosen)
    if first and first_pool is not None:
        chosen.add(first_pool)
    reason, reason_source = (status.capitalize(), status_source) if resolved else (current_barrier or (None, None))
    result = Result(status, status_source, flag_source is not None, flag_source, remaining,
                    available, first, remaining and not available, reason, reason_source)
    return result, Context(resolved, flag_source, barrier, first_pool, defer)


def tasks_in_order(nodes):
    children = defaultdict(list)
    identifiers = set()
    for node in nodes:
        if node.id in identifiers:
            raise ValueError("Duplicate outline identifier")
        identifiers.add(node.id)
        children[node.parent_id].append(node)
    for siblings in children.values():
        siblings.sort(key=lambda node: (node.position, node.id))
    return children, len(identifiers)


def evaluate(nodes, *, now):
    """Return each live row once. Inaccessible or cyclic relationships are invalid."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("An aware evaluation clock is required")
    children, count = tasks_in_order(nodes)
    output = {}
    chosen = set()
    stack = [(root, Context()) for root in reversed(children[None])]
    while stack:
        node, parent = stack.pop()
        result, context = evaluate_node(node, parent, now, chosen)
        output[node.id] = result
        branch = []
        predecessor = None
        for child in children[node.id]:
            inherited = context
            if node.mode == "sequential" and result.remaining:
                if predecessor is not None and context.barrier is None:
                    inherited = replace(context, barrier=("Waiting for earlier item", predecessor))
                elif child.status not in RESOLVED:
                    predecessor = child.id
            branch.append((child, inherited))
        stack.extend(reversed(branch))
    if len(output) != count:
        raise ValueError("An outline parent is missing or cyclic")
    return output
