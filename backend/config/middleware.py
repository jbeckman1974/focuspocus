from django.utils.cache import add_never_cache_headers


class PrivateApiMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.get_host()
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            add_never_cache_headers(response)
        return response
