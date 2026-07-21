"""Tests for the SDLC chain validation integration."""

from __future__ import annotations

import pytest

from sdlc_batch.sdlc_chain import (
    BatchRequest,
    OpenCodeWorker,
    SdlcJob,
    ValidationConfig,
)


def test_validation_config_defaults():
    cfg = ValidationConfig()
    assert cfg.run_typescript_validation is False
    assert cfg.max_validation_iterations == 2


def test_sdlc_job_validation_roundtrip():
    job = SdlcJob(
        job_id="test-1",
        task="Add health endpoint",
        test_cmd="pytest -q",
        validation=ValidationConfig(
            rule_specs=["must return json"],
            rule_codes=["return jsonify({'ok': True})"],
        ),
    )
    data = job.model_dump()
    job2 = SdlcJob(**data)
    assert job2.validation.rule_specs == ["must return json"]
    assert job2.validation.rule_codes == ["return jsonify({'ok': True})"]


def test_worker_extract_text_handles_various_shapes():
    # We need a minimal worker instance; bypass __init__ to avoid secrets.
    worker = object.__new__(OpenCodeWorker)
    worker._client = None  # type: ignore

    assert worker._extract_text({"parts": [{"type": "text", "text": "hello"}]}) == "hello"
    assert worker._extract_text({"message": {"parts": [{"type": "text", "text": "world"}]}}) == "world"
    assert worker._extract_text({}) == ""


def test_worker_run_local_validation():
    worker = object.__new__(OpenCodeWorker)
    worker._client = None  # type: ignore
    worker._validator = None  # type: ignore

    # Since __init__ was bypassed, instantiate a real validator manually.
    from sdlc_batch.validation import ValidationEngine

    worker._validator = ValidationEngine()  # type: ignore

    job = SdlcJob(
        job_id="test-1",
        task="Add health endpoint",
        test_cmd="pytest -q",
        validation=ValidationConfig(
            rule_specs=["endpoint must return json"],
            rule_codes=["return jsonify({'ok': True})"],
        ),
    )
    reports = worker._run_local_validation(job)  # type: ignore
    assert len(reports) == 1
    assert reports[0].passed is True
    assert reports[0].engine == "business-rule"
