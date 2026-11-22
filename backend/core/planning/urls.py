from django.urls import path

from .forecast import forecast
from .review import queue
from .views import planning_view


urlpatterns = [
    path("review", planning_view, {"query": queue}),
    path("forecast", planning_view, {"query": forecast}),
]
