"""Static deployment checks must not initialize the operator's Gateway."""

import sys

from _gateway_shutdown_budget import lifespan_shutdown_seconds


def test_shutdown_budget_can_be_read_without_importing_the_gateway(monkeypatch):
    # The real lifespan budgets remain readable even when importing the app is
    # forbidden. An import would construct it and read the checkout's plugins.
    monkeypatch.setitem(sys.modules, "app.gateway.app", None)
    assert lifespan_shutdown_seconds() > 0
