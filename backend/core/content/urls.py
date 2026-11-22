from django.urls import path

from . import views


urlpatterns = [
    path("items/<uuid:item_id>", views.item_content),
    path("items/<uuid:item_id>/files", views.attach),
    path("items/<uuid:item_id>/files/<uuid:file_id>/download", views.file_bytes),
    path("items/<uuid:item_id>/files/<uuid:file_id>/preview", views.file_bytes, {"preview": True}),
]
