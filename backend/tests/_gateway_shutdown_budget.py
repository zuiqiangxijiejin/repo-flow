"""Shutdown work every deployment's stop grace period must cover.

The chart's ``terminationGracePeriodSeconds`` and both compose files'
``stop_grace_period`` must outlast the Gateway's lifespan shutdown. Besides the
memory queue flush, ``app.gateway.app.lifespan`` runs several *sequential*,
individually bounded hooks around it, and ``langgraph_runtime`` drains in-flight
runs on exit. These numbers are read from the Gateway rather than copied into
the tests, so raising a drain budget or adding a bounded hook here fails the
grace-period tests instead of silently outgrowing the deployments.
"""

from __future__ import annotations

import ast
from pathlib import Path

from app.gateway.deps import _RUN_DRAIN_TIMEOUT_SECONDS
from deerflow.config.memory_config import MemoryConfig

#: Teardown steps in ``app.gateway.app.lifespan`` that each wait up to
#: ``_SHUTDOWN_HOOK_TIMEOUT_SECONDS`` before proceeding. They run one after
#: another, so a pathological shutdown can spend the full budget on every one.
#: Keep this list in step with the ``asyncio.wait_for(..., timeout=
#: _SHUTDOWN_HOOK_TIMEOUT_SECONDS)`` sites in that function.
HOOKS_BOUNDED_BY_SHUTDOWN_HOOK_TIMEOUT: tuple[str, ...] = (
    "startup trash sweep",
    "notification delivery worker stop",
    "channel service stop",
    "scheduled task service stop",
    "subagent batch service stop",
    "browser session close",
    "MCP session pool close",
)


def _app_constants() -> tuple[float, float]:
    """Return ``(_SHUTDOWN_HOOK_TIMEOUT_SECONDS, _RETRIEVAL_WARM_SHUTDOWN_TIMEOUT_SECONDS)``."""
    # Importing this module constructs the app and loads operator plugins. Read
    # the real literal budgets without touching a checkout's configuration.
    source = Path(__file__).resolve().parents[1] / "app/gateway/app.py"
    names = ("_SHUTDOWN_HOOK_TIMEOUT_SECONDS", "_RETRIEVAL_WARM_SHUTDOWN_TIMEOUT_SECONDS")
    values: dict[str, float] = {}
    for node in ast.parse(source.read_text(encoding="utf-8")).body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in names:
                value = ast.literal_eval(node.value)
                if isinstance(value, bool) or not isinstance(value, (float, int)) or value < 0:
                    raise ValueError(f"Shutdown budget {target.id} must be a non-negative numeric literal")
                values[target.id] = float(value)
    return values[names[0]], values[names[1]]


def bounded_hooks_seconds() -> float:
    """Worst case for the sequential hooks bounded by ``_SHUTDOWN_HOOK_TIMEOUT_SECONDS``."""
    hook_timeout, _ = _app_constants()
    return len(HOOKS_BOUNDED_BY_SHUTDOWN_HOOK_TIMEOUT) * hook_timeout


def retrieval_warm_wait_seconds() -> float:
    """Brief wait for the derived retrieval-index rebuild before the flush."""
    _, retrieval_warm_timeout = _app_constants()
    return retrieval_warm_timeout


def run_drain_seconds() -> float:
    """Bound on draining in-flight runs before the checkpointer is torn down."""
    return float(_RUN_DRAIN_TIMEOUT_SECONDS)


def memory_flush_seconds() -> float:
    """Default ``memory.shutdown_flush_timeout_seconds``."""
    return float(MemoryConfig.model_fields["shutdown_flush_timeout_seconds"].default)


def lifespan_shutdown_seconds() -> float:
    """Worst-case lifespan shutdown: every bounded hook + retrieval-warm wait + run drain + memory flush.

    Unbounded steps (OIDC close, MCP task-service stop, backend close) are
    expected to be quick and are not modeled; deployments keep slack on top of
    this figure for them. Sandbox provider shutdown is unbounded too and is not
    quick: it runs one backend destroy per tracked sandbox after the run drain.
    """
    return bounded_hooks_seconds() + retrieval_warm_wait_seconds() + run_drain_seconds() + memory_flush_seconds()
