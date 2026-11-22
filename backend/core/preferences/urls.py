from django.urls import path

from .views import preferences


urlpatterns = [
    path("account", preferences),
    path("device/<uuid:device>", preferences),
]
