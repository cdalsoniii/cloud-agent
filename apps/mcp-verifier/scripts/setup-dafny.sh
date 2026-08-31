#!/usr/bin/env bash

set -e

trap 'echo "Cleaning up..."' EXIT

# Detect OS
OS_TYPE=$(uname -s)
case "$OS_TYPE" in
  "Linux")
    OS="linux"
    ;;
  "Darwin")
    OS="osx"
    ;;
  *)
    echo "Unsupported OS: $OS_TYPE"
    exit 1
    ;;
esac

DafnyVersion="4.9.0"
DafnyUrl="https://github.com/dafny-lang/dafny/releases/download/v${DafnyVersion}/dafny-${DafnyVersion}-${OS}-x64.zip"
TMP_ZIP="/tmp/dafny-${DafnyVersion}.zip"

# Download Dafny
curl -L -o "${TMP_ZIP}" "${DafnyUrl}"

# Unzip to /opt/dafny
sudo mkdir -p /opt/dafny
sudo unzip -o "${TMP_ZIP}" -d /opt/dafny

# Add to PATH in ~/.bashrc if not already present
if ! grep -q '/opt/dafny' ~/.bashrc; then
  echo "export PATH=\"/opt/dafny:${PATH}\"" >> ~/.bashrc
fi

# Source ~/.bashrc for current session
# shellcheck disable=SC1091
source ~/.bashrc

# Verify installation
if dafny --version; then
  echo "Dafny ${DafnyVersion} installed successfully"
  exit 0
else
  echo "Dafny installation failed"
  exit 1
fi
