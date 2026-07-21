"""Debug git push from a Daytona sandbox."""

import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from dotenv import load_dotenv
from sdlc_batch.providers.daytona import DaytonaProvider

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Use the active GitHub CLI OAuth token; fine-grained PATs do not work for git push.
try:
    oauth_token = (
        subprocess.check_output(["gh", "auth", "token"], text=True).strip()
        if shutil.which("gh")
        else ""
    )
except Exception:
    oauth_token = ""
if oauth_token:
    os.environ["GIT_TOKEN"] = oauth_token
else:
    brightforest_token = os.environ.get("GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT")
    if brightforest_token:
        os.environ["GIT_TOKEN"] = brightforest_token


async def main():
    provider = DaytonaProvider()
    inst = await provider.create_sandbox()
    print(f"[daytona] {inst.id} -> {inst.base_url}")

    sandbox = provider._sandboxes[inst.id]
    token = os.environ.get("GIT_TOKEN", "")
    print(f"[token] present={bool(token)} len={len(token)} prefix={token[:7]}")

    try:
        # Clone, modify, configure credentials, push
        cmds = [
            "git clone --depth 1 -b main https://github.com/BrightforestX/meta-utilities.git repo",
            "cd repo && echo 'test' >> test-push.txt",
            "cd repo && git config user.email 'agent@brightforest.ai'",
            "cd repo && git config user.name 'SDLC Agent'",
            "echo 'sandbox GIT_TOKEN len:' ${#GIT_TOKEN}",
            "cd repo && echo \"https://$GIT_TOKEN:x-oauth-basic@github.com\" > .git-credentials && git config credential.helper 'store --file=.git-credentials'",
            "cd repo && git config --list | grep credential",
            "git --version",
            "cd repo && echo 'url=https://github.com' | git credential fill",
            "cd repo && git checkout -b sdlc-test/debug-push",
            "cd repo && git add -A && git commit -m 'debug push'",
            "cd repo && git push -u origin sdlc-test/debug-push",
        ]
        git_env = {"GIT_TOKEN": token} if token else None
        for cmd in cmds:
            print(f"[cmd] {cmd}")
            result = await sandbox.process.exec(cmd, timeout=120, env=git_env)
            print(f"[exit={result.exit_code}] {result.result}")
    finally:
        await provider.destroy_sandbox(inst)


if __name__ == "__main__":
    asyncio.run(main())
