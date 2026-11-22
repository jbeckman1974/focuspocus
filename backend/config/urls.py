from django.urls import include, path

from core import auth_views
from . import site

urlpatterns = [
    path("api/v1/session", auth_views.session_info),
    path("api/v1/login", auth_views.login),
    path("api/v1/logout", auth_views.logout),
    path("api/v1/recover", auth_views.recover),
    path("api/v1/oidc/", include("core.oidc.urls")),
    path("api/v1/", include("core.sharing.account_urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/imports/", include("core.imports.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/portability/", include("core.portability.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/sharing/", include("core.sharing.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/integrations/", include("core.integrations.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/planning/", include("core.planning.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/perspectives/", include("core.perspectives.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/content/", include("core.content.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/preferences/", include("core.preferences.urls")),
    path("api/v1/workspaces/<uuid:workspace_id>/", include("core.command_urls")),
    path("api/v1/", include("core.sync_urls")),
    path("assets/<str:filename>", site.asset),
    path("", site.index),
    path("app/", site.index),
    path("app/<str:filename>", site.shell_file),
    path("sample/", site.index),
]
