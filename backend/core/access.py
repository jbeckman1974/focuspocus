from .models import Membership, Workspace


def locked_membership(user, workspace_id):
    """Within a transaction, lock a visible workspace and recheck its current role."""
    if not user.is_authenticated:
        return None, None
    memberships = Membership.objects.filter(user=user, workspace_id=workspace_id)
    workspace = (
        Workspace.objects.select_for_update(of=("self",))
        .filter(pk__in=memberships.values("workspace_id"))
        .first()
    )
    if workspace is None:
        return None, None
    role = memberships.values_list("role", flat=True).first()
    return (workspace, role) if role is not None else (None, None)
