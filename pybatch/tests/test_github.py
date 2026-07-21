"""Tests for the GitHub publisher and PR verification helpers."""

from __future__ import annotations

from unittest import mock

import pytest

from sdlc_batch.github import GitHubPublisher, _parse_repo
from sdlc_batch.verify_prs import verify_prs


def test_parse_repo_github_url():
    assert _parse_repo("https://github.com/owner/repo") == ("owner", "repo")
    assert _parse_repo("https://github.com/owner/repo.git") == ("owner", "repo")


def test_sanitize_branch():
    publisher = GitHubPublisher(token="fake")
    assert publisher.sanitize_branch("sdlc-batch", "job-123") == "sdlc-batch/job-123"
    assert publisher.sanitize_branch("sdlc-batch", "job 123!") == "sdlc-batch/job-123"


def test_publisher_requires_token_for_api():
    publisher = GitHubPublisher(token="")
    with pytest.raises(RuntimeError):
        publisher._headers()


@pytest.mark.asyncio
async def test_verify_prs_finds_expected_branches():
    publisher = GitHubPublisher(token="fake")
    mock_prs = [
        {"number": 1, "title": "PR 1", "html_url": "https://github.com/o/r/pull/1", "head": {"ref": "sdlc-batch/job-001"}},
        {"number": 2, "title": "PR 2", "html_url": "https://github.com/o/r/pull/2", "head": {"ref": "sdlc-batch/job-002"}},
    ]

    with mock.patch.object(publisher, "list_pull_requests", return_value=mock_prs):
        report = await verify_prs(
            "https://github.com/owner/repo",
            ["job-001", "job-002"],
            branch_prefix="sdlc-batch",
            state="open",
            publisher=publisher,
        )

    assert report["ok"] is True
    assert report["expected"] == 2
    assert report["found"] == 2
    assert len(report["missing"]) == 0
    assert len(report["matched_prs"]) == 2


@pytest.mark.asyncio
async def test_verify_prs_reports_missing():
    publisher = GitHubPublisher(token="fake")
    mock_prs = [
        {"number": 1, "title": "PR 1", "html_url": "https://github.com/o/r/pull/1", "head": {"ref": "sdlc-batch/job-001"}},
    ]

    with mock.patch.object(publisher, "list_pull_requests", return_value=mock_prs):
        report = await verify_prs(
            "https://github.com/owner/repo",
            ["job-001", "job-002"],
            branch_prefix="sdlc-batch",
            state="open",
            publisher=publisher,
        )

    assert report["ok"] is False
    assert report["expected"] == 2
    assert report["found"] == 1
    assert "sdlc-batch/job-002" in report["missing"]
