from .models import Membership


def membership_for(user, workspace_id):
    if not user.is_authenticated:
        return None
    return Membership.objects.filter(user=user, workspace_id=workspace_id).select_related("workspace").first()
