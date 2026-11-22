from django.urls import path

from .commands import views


urlpatterns = [
    path("commands/<slug:name>", views.command),
    path("items/<uuid:item_id>", views.item_detail),
]
