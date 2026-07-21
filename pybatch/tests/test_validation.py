"""Tests for the validation engine."""

from __future__ import annotations

import pytest

from sdlc_batch.validation import (
    ValidationEngine,
    ValidationResult,
    resolve_validation_cmd,
)


def test_resolve_validation_cmd_prefers_explicit():
    cmd = resolve_validation_cmd(
        validation_cmd="echo hi",
        formal_suite="quint",
        formal_paths=["config/verification/quint/sandbox-lifecycle.qnt"],
    )
    assert cmd == "echo hi"


def test_resolve_validation_cmd_expands_quint_path():
    cmd = resolve_validation_cmd(
        formal_suite="quint",
        formal_paths=["config/verification/quint/sandbox-lifecycle.qnt"],
    )
    assert cmd is not None
    assert "sandbox-lifecycle.qnt" in cmd
    assert "quint" in cmd


def test_resolve_validation_cmd_none_without_inputs():
    assert resolve_validation_cmd() is None


def test_run_local_rules_passes_when_keywords_match():
    engine = ValidationEngine()
    results = engine.run_local_rules(
        rule_specs=["endpoint must return application json"],
        rule_codes=["return jsonify({'ok': True})"],
    )
    assert len(results) == 1
    assert results[0].passed is True
    assert results[0].engine == "business-rule"


def test_run_local_rules_fails_when_keywords_missing():
    engine = ValidationEngine()
    results = engine.run_local_rules(
        rule_specs=["endpoint must validate jwt token"],
        rule_codes=["return jsonify({'ok': True})"],
    )
    assert len(results) == 1
    assert results[0].passed is False
    assert "validate" in results[0].details["missing"]


def test_run_local_rules_raises_on_mismatched_lengths():
    engine = ValidationEngine()
    with pytest.raises(ValueError):
        engine.run_local_rules(
            rule_specs=["rule one", "rule two"],
            rule_codes=["code one"],
        )


def test_summarize_all_passed():
    engine = ValidationEngine()
    results = [
        ValidationResult(passed=True, engine="lint"),
        ValidationResult(passed=True, engine="business-rule"),
    ]
    summary = engine.summarize(results)
    assert summary["passed"] is True
    assert summary["total"] == 2
    assert len(summary["failures"]) == 0


def test_summarize_with_failures():
    engine = ValidationEngine()
    results = [
        ValidationResult(passed=True, engine="lint"),
        ValidationResult(passed=False, engine="business-rule"),
    ]
    summary = engine.summarize(results)
    assert summary["passed"] is False
    assert len(summary["failures"]) == 1
