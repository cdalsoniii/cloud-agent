"""Multi-provider sandbox spawner for the SDLC batch loop."""

from __future__ import annotations

import asyncio
import os
from typing import Optional

from sdlc_batch.providers.base import SandboxInstance, SandboxProvider
from sdlc_batch.providers.daytona import DaytonaProvider
from sdlc_batch.providers.e2b import E2BProvider
from sdlc_batch.providers.northflank import NorthflankProvider


_PROVIDER_MAP: dict[str, type[SandboxProvider]] = {
    "daytona": DaytonaProvider,
    "e2b": E2BProvider,
    "northflank": NorthflankProvider,
}


def provider_factory(name: str, **kwargs) -> SandboxProvider:
    """Create a sandbox provider by name.

    Args:
        name: one of "daytona", "e2b", "northflank".
        **kwargs: forwarded to the provider constructor.

    Raises:
        ValueError: if the provider name is unknown.
    """
    name = name.lower()
    if name not in _PROVIDER_MAP:
        raise ValueError(f"Unknown provider: {name}. Available: {list(_PROVIDER_MAP.keys())}")
    return _PROVIDER_MAP[name](**kwargs)


class MultiProviderSpawner:
    """Spawn and manage sandboxes across multiple providers.

    Priority defaults to Daytona if no provider order is given.
    """

    def __init__(
        self,
        providers: Optional[list[str]] = None,
        instances_per_provider: int = 1,
        provider_kwargs: Optional[dict[str, dict]] = None,
    ):
        self.provider_order = providers or ["daytona", "e2b", "northflank"]
        self.instances_per_provider = instances_per_provider
        self.provider_kwargs = provider_kwargs or {}
        self._providers: dict[str, SandboxProvider] = {}
        self._instances: list[SandboxInstance] = []

    async def spawn(self) -> list[SandboxInstance]:
        """Spawn sandboxes across all configured providers."""
        tasks: list[asyncio.Task[SandboxInstance]] = []
        for name in self.provider_order:
            kwargs = self.provider_kwargs.get(name, {})
            provider = provider_factory(name, **kwargs)
            self._providers[name] = provider
            for _ in range(self.instances_per_provider):
                tasks.append(asyncio.create_task(provider.create_sandbox()))
                await asyncio.sleep(0)

        results = await asyncio.gather(*tasks, return_exceptions=True)
        instances: list[SandboxInstance] = []
        for r in results:
            if isinstance(r, Exception):
                print(f"[spawner] failed to spawn sandbox: {r}")
                continue
            instances.append(r)
        self._instances = instances
        return instances

    async def health_check_all(self) -> dict[str, bool]:
        """Health-check all spawned instances and return id -> healthy map."""
        tasks = {
            inst.id: asyncio.create_task(self._health_check_one(inst))
            for inst in self._instances
        }
        return {
            inst_id: await task for inst_id, task in tasks.items()
        }

    async def _health_check_one(self, instance: SandboxInstance) -> bool:
        provider = self._providers.get(instance.provider)
        if provider is None:
            return False
        try:
            return await provider.health_check(instance)
        except Exception as e:
            print(f"[spawner] health check failed for {instance.id}: {e}")
            return False

    async def destroy_all(self) -> None:
        """Destroy all spawned sandboxes and close provider HTTP clients."""
        tasks = [
            asyncio.create_task(self._destroy_one(inst))
            for inst in self._instances
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        self._instances.clear()
        for provider in self._providers.values():
            close = getattr(provider, "close", None)
            if close is not None:
                try:
                    await close()
                except Exception as e:
                    print(f"[spawner] provider close failed for {provider.name}: {e}")

    async def _destroy_one(self, instance: SandboxInstance) -> None:
        provider = self._providers.get(instance.provider)
        if provider is None:
            return
        try:
            await provider.destroy_sandbox(instance)
        except Exception as e:
            print(f"[spawner] destroy failed for {instance.id}: {e}")

    async def __aenter__(self) -> "MultiProviderSpawner":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.destroy_all()
