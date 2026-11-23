import re

from django.conf import settings
from django.http import FileResponse, Http404
from django.views.decorators.http import require_safe


def public_file(relative_path, content_type=None, cache_control="no-cache"):
    try:
        response = FileResponse((settings.SPA_ROOT / relative_path).open("rb"), content_type=content_type)
    except FileNotFoundError as error:
        raise Http404 from error
    response["Cache-Control"] = cache_control
    return response


@require_safe
def index(request):
    return public_file("index.html", "text/html; charset=utf-8")


SHELL_FILES = {
    "third-party-licenses.json": "application/json",
    "sw.js": "text/javascript",
    "legacy-push.js": "text/javascript",
    "manifest.webmanifest": "application/manifest+json",
    "icon-192.png": "image/png",
    "icon-512.png": "image/png",
}


@require_safe
def shell_file(request, filename):
    if filename not in SHELL_FILES:
        raise Http404
    return public_file("app/" + filename, SHELL_FILES[filename])


@require_safe
def asset(request, filename):
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.(?:js|css|svg|woff2)", filename):
        raise Http404
    if (re.fullmatch(r"notification-worker-[A-Za-z0-9_-]{8,64}\.js", filename)
            and not (settings.SPA_ROOT / "assets" / filename).is_file()):
        # Installed M5 subscriptions still request their old hashed script URL.
        return public_file("app/legacy-push.js", "text/javascript")
    return public_file("assets/" + filename, cache_control="public, max-age=31536000, immutable")
