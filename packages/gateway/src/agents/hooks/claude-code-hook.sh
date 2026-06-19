#!/usr/bin/env bash
# Claude Code PermissionRequest hook
# Converts Claude Code JSON input → unified format → calls agent-watch CLI → converts output back

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_PATH="${SCRIPT_DIR}/../../../cli/bin/agent-watch-hook.js"

# Read JSON from stdin
stdin_data=""
if [[ ! -t 0 ]]; then
  stdin_data=$(cat)
fi

# Default values
GATEWAY_URL="${AGENT_WATCH_APPROVE_GATEWAY:-http://localhost:3000}"
EXIT_CODE=0

# Helper: convert Claude Code input to unified format
convert_to_unified() {
  local input="$1"
  local session_id tool_name tool_input permission_mode command

  session_id=$(echo "$input" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//')
  tool_name=$(echo "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//')
  tool_input=$(echo "$input" | grep -o '"tool_input"[[:space:]]*:[[:space:]]*{[^}]*}' | head -1 | sed 's/"tool_input"[[:space:]]*:[[:space:]]*//')
  permission_mode=$(echo "$input" | grep -o '"permission_mode"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//')

  # Extract command from tool_input if present
  if [[ -z "$command" ]]; then
    command=$(echo "$tool_input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//')
  fi

  # If permission_mode is bypassPermissions, return allow immediately
  if [[ "$permission_mode" == "bypassPermissions" ]]; then
    echo '{"decision":"allow","reason":"permission_mode=bypassPermissions","exitCode":0}'
    return 0
  fi

  # Build unified JSON
  local unified_json="{}"
  if [[ -n "$session_id" ]]; then
    unified_json=$(echo "$unified_json" | jq -c --arg s "$session_id" '. + {session_id: $s}')
  fi
  if [[ -n "$tool_name" ]]; then
    unified_json=$(echo "$unified_json" | jq -c --arg t "$tool_name" '. + {agent: "claude-code", tool_name: $t}')
  fi
  if [[ -n "$command" ]]; then
    unified_json=$(echo "$unified_json" | jq -c --arg c "$command" '. + {command: $c}')
  fi

  echo "$unified_json"
}

# Helper: convert unified output to Claude Code format
convert_from_unified() {
  local unified_output="$1"
  local decision
  decision=$(echo "$unified_output" | grep -o '"decision"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"//;s/"$//')
  echo "{\"decision\":\"$decision\"}"
}

# Parse stdin JSON properly with jq
if [[ -z "$stdin_data" ]]; then
  echo '{"decision":"deny","reason":"empty stdin","exitCode":2}'
  exit 2
fi

# Check for permission_mode=bypassPermissions first
permission_mode=$(echo "$stdin_data" | jq -r '.permission_mode // empty')
if [[ "$permission_mode" == "bypassPermissions" ]]; then
  echo '{"decision":"approve"}'
  exit 0
fi

# Convert to unified format
unified_input=$(echo "$stdin_data" | jq -c '{
  agent: "claude-code",
  tool_name: .tool_name,
  command: .tool_input.command,
  tool_input: .tool_input,
  cwd: .workspace,
  session_id: .session_id
}')

# Call the unified CLI
cli_output=$(echo "$unified_input" | node "$CLI_PATH" --gateway "$GATEWAY_URL" 2>/dev/null) || {
  echo '{"decision":"deny","reason":"CLI error","exitCode":2}'
  exit 2
}

# Parse CLI output
decision=$(echo "$cli_output" | jq -r '.decision // empty')
exit_code=$(echo "$cli_output" | jq -r '.exitCode // 2')

# Convert to Claude Code format
if [[ "$decision" == "allow" || "$decision" == "approve" ]]; then
  echo '{"decision":"approve"}'
  exit 0
else
  echo '{"decision":"deny"}'
  exit 2
fi
