#!/usr/bin/env bash

set -e

# Exit on any error and perform cleanup
trap 'echo "Cleaning up..."' EXIT

# Verify required environment variables
required_vars=(DAYTONA_API_KEY GIT_TOKEN GIT_REPO_URL)
for var in "${required_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    echo "Error: $var is not set"
    exit 1
  fi
done

# Install Node.js 20 using n (fallback to nvm)
if command -v n >/dev/null 2>&1; then
  sudo n 20
elif command -v nvm >/dev/null 2>&1; then
  nvm install 20
else
  echo "Node version manager not found. Please install 'n' or 'nvm' manually."
  exit 1
fi

# Install Dafny (download latest 4.9.0 release)
DafnyVersion="4.9.0"
OS=$(uname -s)
case "$OS" in
  "Linux")
    DafnyUrl="https://github.com/dafny-lang/dafny/releases/download/v${DafnyVersion}/dafny-${DafnyVersion}-linux-x64.zip"
    ;;
  "Darwin")
    DafnyUrl="https://github.com/dafny-lang/dafny/releases/download/v${DafnyVersion}/dafny-${DafnyVersion}-osx-x64.zip"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

TMP_ZIP="/tmp/dafny.zip"
curl -L -o "$TMP_ZIP" "$DafnyUrl"
sudo unzip -o "$TMP_ZIP" -d /opt/dafny
sudo ln -sf /opt/dafny/dafny /usr/local/bin/dafny

# Clone repository
REPO_DIR="/tmp/repo"
rm -rf "$REPO_DIR"
git clone "https://$GIT_TOKEN@${GIT_REPO_URL}" "$REPO_DIR"
cd "$REPO_DIR"

# Install dependencies and build
npm ci
npm run build

# Start Next.js server in background
npm start -- --hostname 0.0.0.0 --port 3000 &
NEXT_PID=$!

# Start Mastra server in background
npx tsx mastra/index.ts --port 4111 &
MASTRA_PID=$!

# Give servers time to start
sleep 5

# Health checks
if ! curl -f http://localhost:3000/api/health; then
  echo "Next.js health check failed"
  exit 1
fi
if ! curl -f http://localhost:4111/health; then
  echo "Mastra health check failed"
  exit 1
fi

echo "Deployment successful!"
echo "Next.js: http://localhost:3000"
echo "Mastra API: http://localhost:4111"

# Wait for background processes (optional, keep script running)
wait $NEXT_PID $MASTRA_PID
