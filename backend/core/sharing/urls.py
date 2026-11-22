from django.urls import path

from . import views


urlpatterns = [
    path("", views.roster),
    path("invites", views.issue_invitation),
    path("invites/<uuid:invitation_id>/revoke", views.revoke_invitation),
    path("members/<int:target_id>", views.change_member),
    path("credentials", views.credentials),
    path("credentials/<uuid:credential_id>/revoke", views.revoke_credential),
]
