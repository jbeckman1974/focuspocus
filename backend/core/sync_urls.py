from django.urls import path

from core.sync import views


urlpatterns = [
    path("health/live", views.live),
    path("health/ready", views.ready),
    path("workspaces/<uuid:workspace_id>/date-preview", views.workspace_read, {"mode": "date-preview"}),
    path("workspaces/<uuid:workspace_id>/outline", views.workspace_read, {"mode": "outline"}),
    path("workspaces/<uuid:workspace_id>/snapshot", views.workspace_read, {"mode": "snapshot"}),
    path("workspaces/<uuid:workspace_id>/changes", views.workspace_read, {"mode": "changes"}),
]
