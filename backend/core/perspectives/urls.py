from django.urls import path

from .views import endpoint


urlpatterns = [
    path("", endpoint, {"mode": "list"}),
    path("commands", endpoint, {"mode": "commands"}),
    path("query", endpoint, {"mode": "query"}),
]
