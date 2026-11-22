from core.access import locked_membership
from core.models import Membership


def job_workspace(job):
    workspace, _ = locked_membership(job.actor, job.workspace_id)
    if workspace and Membership.objects.filter(workspace=workspace, user_id=job.actor_id, user__is_active=True).exists():
        return workspace
    return None
