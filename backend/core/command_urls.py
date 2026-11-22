from django.urls import path

from core.repeats import views as repeat_views

from .commands import shelf_views, views


urlpatterns = [
    path("repeat-preview", repeat_views.preview),
    path("shelf", shelf_views.shelf),
    path("archive-preview", shelf_views.archive_preview),
    path("commands/<slug:name>", views.command),
    path("items/<uuid:item_id>", views.item_detail),
]
