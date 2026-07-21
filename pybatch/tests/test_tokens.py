"""Tests for dual-account GitHub token resolution."""

from __future__ import annotations

from unittest import mock

import pytest

from sdlc_batch.tokens import parse_owner_repo, resolve_github_token


def test_parse_owner_repo():
    assert parse_owner_repo("https://github.com/BrightforestX/meta-utilities.git") == (
        "BrightforestX",
        "meta-utilities",
    )
    assert parse_owner_repo("https://github.com/cdalsoniii/cloud-agent") == (
        "cdalsoniii",
        "cloud-agent",
    )


def test_resolve_brightforest_prefers_oauth():
    with mock.patch("sdlc_batch.tokens.read_gh_oauth_token", return_value="gho_test_oauth"):
        with mock.patch.dict("os.environ", {"GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT": "fgp_pat"}, clear=False):
            resolved = resolve_github_token("BrightforestX")
    assert resolved.token == "gho_test_oauth"
    assert resolved.source == "gh-oauth-hosts.yml"


def test_resolve_brightforest_falls_back_to_org_pat():
    env = {
        "GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT": "fgp_pat_only",
        "GITHUB_TOKEN": "",
        "GH_TOKEN": "",
        "GIT_TOKEN": "",
        "GITHUB_TOKEN_PERSONAL": "",
    }
    with mock.patch("sdlc_batch.tokens.read_gh_oauth_token", return_value=""):
        with mock.patch.dict("os.environ", env, clear=False):
            resolved = resolve_github_token("BrightforestX")
    assert resolved.token == "fgp_pat_only"
    assert "BRIGHTFOREST" in resolved.source


def test_resolve_personal_uses_oauth():
    with mock.patch("sdlc_batch.tokens.read_gh_oauth_token", return_value="gho_personal"):
        with mock.patch("sdlc_batch.tokens._first_env", return_value=("", "")):
            resolved = resolve_github_token("cdalsoniii")
    assert resolved.token == "gho_personal"
    assert resolved.source == "gh-oauth-hosts.yml"


def test_resolve_missing_raises():
    with mock.patch("sdlc_batch.tokens.read_gh_oauth_token", return_value=""):
        with mock.patch("sdlc_batch.tokens._first_env", return_value=("", "")):
            with pytest.raises(RuntimeError):
                resolve_github_token("BrightforestX")
