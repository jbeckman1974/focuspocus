from django.urls import path

from . import views


urlpatterns = [
    path("sharing/workspaces", views.workspaces),
    path("sharing/accept", views.accept_invitation),
    path("capture/context", views.bearer_capture, {"context": True}),
    path("capture", views.bearer_capture),
]
