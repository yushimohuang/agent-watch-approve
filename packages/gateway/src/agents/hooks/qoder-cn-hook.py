#!/usr/bin/env python3
"""
Agent Watch Hook for Qoder CN (通义灵码)

通义灵码的 PreToolUse hook 可以直接通过 stdout 返回 permissionDecision：
   {"permissionDecision": "allow" | "deny" | "ask", "reason": "..."}
   {"continue": false, "stopReason": "..."}

输入（stdin, JSON）：
   {
     "session_id": "...",
     "cwd": "/path/to/project",
     "tool_name": "Bash",
     "tool_input": { "command": "..." }
   }
"""

import json
import os
import subprocess
import sys


def main():
    # 读取 stdin
    try:
        input_data = json.load(sys.stdin)
    except Exception as e:
        # 解析失败 - 默认放行（不阻断）
        sys.exit(0)
        return

    # 提取信息
    tool_name = input_data.get("tool_name", "unknown")
    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""

    # 配置
    gateway = os.environ.get("AGENT_WATCH_GATEWAY", "http://localhost:3000")
    user_id = os.environ.get("AGENT_WATCH_USER", "")
    timeout = os.environ.get("AGENT_WATCH_TIMEOUT", "60")

    # 调用 agent-watch CLI
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
        cli_output = result.stdout.strip()
        if not cli_output:
            cli_output = '{"decision": "deny", "reason": "Empty CLI output"}'
    except subprocess.TimeoutExpired:
        cli_output = '{"decision": "deny", "reason": "CLI timeout"}'
    except Exception as e:
        cli_output = json.dumps({"decision": "deny", "reason": f"CLI error: {e}"})

    # 解析 CLI 输出
    try:
        cli_result = json.loads(cli_output)
        decision = cli_result.get("decision", "deny")
        reason = cli_result.get("reason", "")
    except Exception:
        decision = "deny"
        reason = "Failed to parse CLI output"

    # 输出 Qoder CN 期望的格式
    if decision == "approve":
        output = {
            "permissionDecision": "allow",
            "permissionDecisionReason": reason or "User approved",
        }
    else:
        output = {
            "permissionDecision": "deny",
            "permissionDecisionReason": reason or "User denied",
        }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
