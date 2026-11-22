import re

from django.conf import settings
from django.http import FileResponse, Http404
from django.views.decorators.http import require_safe


@require_safe
def index(request):
    try:
        response = FileResponse((settings.SPA_ROOT / "index.html").open("rb"), content_type="text/html")
    except FileNotFoundError as error:
        raise Http404 from error
    response["Cache-Control"] = "no-cache"
    return response


@require_safe
def asset(request, filename):
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.(?:js|css|svg|woff2)", filename):
        raise Http404
    try:
        return FileResponse((settings.SPA_ROOT / "assets" / filename).open("rb"))
    except FileNotFoundError as error:
        raise Http404 from error
