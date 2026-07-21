"""Tests for the multi-provider spawner and provider factory."""

from __future__ import annotations

import pytest

from sdlc_batch.providers.base import SandboxProvider
from sdlc_batch.providers.daytona import DaytonaProvider
from sdlc_batch.providers.e2b import E2BProvider
from sdlc_batch.providers.northflank import NorthflankProvider
from sdlc_batch.spawner import MultiProviderSpawner, provider_factory


def test_provider_factory_daytona():
    provider = provider_factory("daytona")
    assert isinstance(provider, DaytonaProvider)


def test_provider_factory_e2b():
    provider = provider_factory("e2b")
    assert isinstance(provider, E2BProvider)


def test_provider_factory_northflank():
    provider = provider_factory("northflank")
    assert isinstance(provider, NorthflankProvider)


def test_provider_factory_unknown():
    with pytest.raises(ValueError):
        provider_factory("unknown")


def test_spawner_defaults_to_daytona():
    spawner = MultiProviderSpawner()
    assert spawner.provider_order == ["daytona", "e2b", "northflank"]
    assert spawner.instances_per_provider == 1


def test_spawner_custom_provider_order():
    spawner = MultiProviderSpawner(providers=["e2b", "daytona"], instances_per_provider=2)
    assert spawner.provider_order == ["e2b", "daytona"]
    assert spawner.instances_per_provider == 2
