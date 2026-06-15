#!/usr/bin/env python3
"""
Agent Watch Hook for CodeBuddy (腾讯云)

兼容 Claude Code Hook 规范。
CodeBuddy 支持 7 个事件: SessionStart, SessionEnd, PreToolUse,
                          PostToolUse, UserPromptSubmit, Stop, PreCompact

输入/输出格式与 Claude Code 相同。
"""

import json
import os
import subprocess
import sys


def main():
    try:
        input_data = json.load(sys.stdin)
    except Exception:
        # 解析失败放行
        print(json.dumps({"continue": True}))
        return

    # 区分事件类型
    event_name = input_data.get("hook_event_name", "")

    # 只在 PreToolUse 时拦截
    if event_name != "PreToolUse":
        print(json.dumps({"continue": True}))
        return

    tool_name = input_data.get("tool_name", "unknown")
    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""

    gateway = os.environ.get("AGENT_WATCH_GATEWAY", "http://localhost:3000")
    user_id = os.environ.get("AGENT_WATCH_USER", "")
    timeout = os.environ.get("AGENT_WATCH_TIMEOUT", "60")

    try:
        result = subprocess.run(
            [
                "agent-watch", "approve",
                f"--gateway={gateway}",
                f"--user={user_id}",
                f"--tool={tool_name}",
                f"--command={command}",
                f"--timeout={timeout}",
            ],
            capture_output=True,
            text=True,
            timeout=int(timeout) + 10,
        )
        cli_output = result.stdout.strip() or '{"decision": "deny"}'
    except Exception as e:
        cli_output = json.dumps({"decision": "deny", "reason": str(e)})

    try:
        cli_result = json.loads(cli_output)
        decision = cli_result.get("decision", "deny")
        reason = cli_result.get("reason", "")
    except Exception:
        decision = "deny"
        reason = "Parse error"

    # CodeBuddy 输出格式
    if decision == "approve":
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "permissionDecisionReason": reason,
            }
        }
    else:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
