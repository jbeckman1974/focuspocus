from django.http import JsonResponse
from django.utils.cache import add_never_cache_headers


class PrivateApiMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def process_view(self, request, view_func, view_args, view_kwargs):
        # Match the resolved workspace route so new readers and writers inherit
        # the same account-switch guard, including the snapshot that issues write contexts.
        if "workspace_id" in view_kwargs:
            actor = request.headers.get("X-FocusPocus-Actor")
            if actor is not None and request.user.is_authenticated and actor != str(request.user.pk):
                return JsonResponse({"error": "The signed-in account changed."}, status=403)
        return None

    def __call__(self, request):
        request.get_host()
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            add_never_cache_headers(response)
        return response
