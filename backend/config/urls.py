from django.urls import include, path

from core import auth_views
from . import site

urlpatterns = [
    path("api/v1/session", auth_views.session_info),
    path("api/v1/login", auth_views.login),
    path("api/v1/logout", auth_views.logout),
    path("api/v1/recover", auth_views.recover),
    path("api/v1/workspaces/<uuid:workspace_id>/", include("core.command_urls")),
    path("api/v1/", include("core.sync_urls")),
    path("assets/<str:filename>", site.asset),
    path("", site.index),
    path("app/", site.index),
    path("sample/", site.index),
]
