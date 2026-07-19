#!/bin/bash

# Load OpenCode sessions into SurrealDB

SESSIONS_FILE="opencode-sessions.json"
SURREALDB_URL="http://localhost:8000"
AUTH="Basic $(echo -n 'root:root' | base64)"

echo "📋 Loading OpenCode sessions from $SESSIONS_FILE"

# Read and parse the JSON file
SESSIONS=$(cat "$SESSIONS_FILE")
COUNT=$(echo "$SESSIONS" | jq length)

echo "✅ Found $COUNT sessions"

# Load each session into SurrealDB
for i in $(seq 0 $(($COUNT - 1))); do
  
  SESSION=$(echo "$SESSIONS" | jq -c ".[$i]")
  ID=$(echo "$SESSION" | jq -r '.id')
  TITLE=$(echo "$SESSION" | jq -r '.title')
  
  echo "📦 Loading session $ID"
  
  # Parse completion status from title
  if [[ "$TITLE" == {* ]]; then
    PASS=$(echo "$TITLE" | jq -r '.pass' 2>/dev/null || echo "false")
    REASONS=$(echo "$TITLE" | jq -c '.reasons' 2>/dev/null || echo "[]")
  else
    PASS="false"
    REASONS="[\"No completion data\"]"
  fi
  
  STATUS=$([ "$PASS" = "true" ] && echo "completed" || echo "failed")
  
  # Create the SurrealDB query
  QUERY="USE NS main DB main; CREATE opencode_sessions:$ID CONTENT {
    id: '$ID',
    title: '$TITLE',
    status: '$STATUS',
    pass: $PASS,
    reasons: $REASONS,
    cost: 0,
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    created: time::now(),
    updated: time::now(),
    agent: 'opencode-cli',
    model: 'unknown',
    directory: '$(echo "$SESSION" | jq -r '.directory')',
    project_id: '$(echo "$SESSION" | jq -r '.projectId')',
    duration: 0s,
    summary: { additions: 0, deletions: 0, files: [] }
  }"
  
  # Execute the query
  curl -s -X POST "$SURREALDB_URL/sql" \
    -H "Content-Type: text/plain" \
    -H "Authorization: $AUTH" \
    -d "$QUERY" > /dev/null
  
  echo "   ✅ Loaded session $ID"
  
  # Add small delay to avoid overwhelming the database
  sleep 0.1
done

echo "🎉 Sessions loaded successfully"