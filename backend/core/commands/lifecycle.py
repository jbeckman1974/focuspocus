"""Route tree lifecycle commands inside the workspace write transaction."""

from . import filing, shelves, tagging


COMMANDS = frozenset({
    "duplicate", "delete", "restore", "archive", "retrieve", "ungroup", "file-inbox",
    "assign-filing", "set-filing-policy", "edit-tag",
})


def dispatch(tree, name, payload):
    if name in ("archive", "delete"):
        return shelves.remove(tree, name, payload)
    if name in ("retrieve", "restore"):
        return shelves.recover(tree, name, payload)
    simple = {
        "duplicate": shelves.duplicate,
        "ungroup": shelves.ungroup,
        "file-inbox": filing.file_inbox,
        "assign-filing": filing.assign,
        "set-filing-policy": filing.set_policy,
        "edit-tag": tagging.edit_tag,
    }
    return simple[name](tree, payload)
