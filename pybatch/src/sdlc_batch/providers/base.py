"""Base provider abstraction for multi-sandbox SDLC batching."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class SandboxInstance:
    """Represents a running sandbox that can host an OpenCode server."""

    id: str
    base_url: str
    provider: str
    metadata: dict[str, Any]
    is_healthy: bool = False

    @property
    def opencode_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/session"


class SandboxProvider(ABC):
    """Abstract interface for sandbox lifecycle management."""

    name: str

    @abstractmethod
    async def create_sandbox(
        self,
        image: str = "opencode",
        envs: Optional[dict[str, str]] = None,
        timeout_seconds: int = 3600,
        auto_pause: bool = True,
    ) -> SandboxInstance:
        """Create a new sandbox and return its instance metadata."""
        ...

    @abstractmethod
    async def destroy_sandbox(self, instance: SandboxInstance) -> None:
        """Destroy a sandbox instance."""
        ...

    @abstractmethod
    async def health_check(self, instance: SandboxInstance) -> bool:
        """Check whether the OpenCode server inside the sandbox is healthy."""
        ...

    @abstractmethod
    async def exec_command(self, instance: SandboxInstance, command: str) -> dict[str, Any]:
        """Run a shell command inside the sandbox and return the result."""
        ...

    async def __aenter__(self) -> "SandboxProvider":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        pass
