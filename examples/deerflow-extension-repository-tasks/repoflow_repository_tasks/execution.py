"""Start a configured RepoFlow instance through an OpenSSH host alias."""

import re
import subprocess
from urllib.parse import urlsplit

from deerflow_extension_api.agent_runs import AgentRunError

_HOST = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_SERVICE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.@-]*\.(?:service|target)")


def web_origin(value):
    if not isinstance(value, str) or re.search(r"[\s\\]", value):
        raise ValueError("Invalid remote RepoFlow origin")
    parsed = urlsplit(value)
    loopback = parsed.hostname in {"127.0.0.1", "::1", "localhost"} or (parsed.hostname and parsed.hostname.endswith(".localhost"))
    if (
        not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
        or not (parsed.scheme == "https" or parsed.scheme == "http" and loopback)
        or parsed.port == 0
    ):
        raise ValueError("Use a distinct HTTPS host or loopback HTTP origin for remote RepoFlow")
    return f"{parsed.scheme}://{parsed.netloc}"


class Execution:
    def __init__(self, config):
        self.host = config.get("ssh_host")
        if self.host is not None and (not isinstance(self.host, str) or not _HOST.fullmatch(self.host)):
            raise ValueError("Invalid execution SSH host alias")
        self.connections = {}
        for host, target in config.get("connections", {}).items():
            if not isinstance(host, str) or not _HOST.fullmatch(host) or host == self.host:
                raise ValueError("Invalid SSH connection alias")
            service = target.get("service", "repoflow.target")
            port = target.get("port", 12026)
            if not isinstance(service, str) or not _SERVICE.fullmatch(service):
                raise ValueError("Invalid remote systemd unit")
            if type(port) is not int or not 1 <= port <= 65535:
                raise ValueError("Invalid remote readiness port")
            self.connections[host] = (service, port, web_origin(target["origin"]))

    def view(self):
        return {"ssh_host": self.host, "hosts": list(self.connections)}

    def connect(self, host):
        if not isinstance(host, str) or host not in self.connections:
            raise AgentRunError(404, "SSH connection is not configured.")
        service, port, origin = self.connections[host]
        # The remote shell receives only a validated unit, an integer port,
        # and a fixed operator command. The browser only chooses an alias.
        command = f"systemctl --user start {service} && test \"$(curl --fail --silent --retry 3 --retry-all-errors --retry-delay 1 --max-time 3 --output /dev/null --write-out '%{{http_code}}' http://localhost:{port}/health/ready)\" = 200"
        try:
            subprocess.run(
                [
                    "ssh",
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "StrictHostKeyChecking=yes",
                    "-o",
                    "ConnectTimeout=6",
                    "--",
                    host,
                    command,
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=24,
            )
        except (
            OSError,
            subprocess.CalledProcessError,
            subprocess.TimeoutExpired,
        ) as exc:
            raise AgentRunError(502, "Could not start the configured remote RepoFlow service.") from exc
        return {"host": host, "origin": origin}
