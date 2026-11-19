from importlib import import_module

from app.gateway.config import GatewayConfig


def test_workspace_profile_mounts_repo_and_agent_routes_without_optional_services(monkeypatch, tmp_path):
    settings = tmp_path / "config.yaml"
    settings.write_text("models: []\nsandbox:\n  use: deerflow.sandbox.local:LocalSandboxProvider\n", encoding="utf-8")
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(settings))
    gateway = import_module("app.gateway.app")
    monkeypatch.setattr(gateway, "get_gateway_config", lambda: GatewayConfig(profile="workspace"))
    app = gateway.create_app()
    routes = app.openapi()["paths"]
    assert app.state.repoflow_workspace
    assert "/api/models" in routes
    assert any(path.startswith("/api/plugins/") for path in routes)
    assert any(path.startswith("/api/subagents") for path in routes)
    assert any(path.startswith("/api/v1/auth/") for path in routes)
    assert any(path.startswith("/api/threads/") and "/runs" in path for path in routes)
    assert not any(path.startswith(("/api/channels", "/api/scheduled-tasks", "/api/console", "/api/memory", "/api/integrations", "/api/input-polish")) or "/browser" in path for path in routes)
