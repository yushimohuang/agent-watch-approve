#!/usr/bin/env bash
#
# Agent Watch Hook for Claude Code
#
# 用途：作为 Claude Code 的 PermissionRequest hook，
#       在 Agent 触发敏感操作时调用 agent-watch CLI
#
# 安装：
#   1. 安装 agent-watch CLI: npm install -g agent-watch-cli
#   2. 在 ~/.claude/settings.json 添加：
#      {
#        "hooks": {
#          "PermissionRequest": [{
#            "command": "/path/to/this/script.sh"
#          }]
#        }
#      }
#
# 输入（stdin, JSON）：
#   {
#     "session_id": "...",
#     "cwd": "/path/to/project",
#     "permission_mode": "default",
#     "tool_name": "Bash",
#     "tool_input": { "command": "..." }
#   }
#
# 输出（stdout, JSON）：
#   {
#     "decision": "approve" | "deny" | "timeout",
#     "reason": "..."
#   }

set -e

# 读取 stdin
INPUT=$(cat)

# 解析配置
GATEWAY="${AGENT_WATCH_GATEWAY:-http://localhost:3000}"
USER_ID="${AGENT_WATCH_USER:-}"
TIMEOUT="${AGENT_WATCH_TIMEOUT:-60}"

# 提取工具信息
TOOL_NAME=$(echo "$INPUT" | grep -oE '"tool_name"\s*:\s*"[^"]*"' | sed 's/"tool_name"\s*:\s*"\(.*\)"/\1/' || echo "unknown")
COMMAND=$(echo "$INPUT" | grep -oE '"command"\s*:\s*"[^"]*"' | head -1 | sed 's/"command"\s*:\s*"\(.*\)"/\1/' || echo "")

# 调用 agent-watch CLI
RESULT=$(agent-watch approve \
  --gateway="$GATEWAY" \
  --user="$USER_ID" \
  --tool="$TOOL_NAME" \
  --command="$COMMAND" \
  --timeout="$TIMEOUT" 2>/dev/null || echo '{"decision":"deny","reason":"CLI failed"}')

# 输出结果
echo "$RESULT"
