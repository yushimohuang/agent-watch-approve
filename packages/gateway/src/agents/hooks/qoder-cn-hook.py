#!/usr/bin/env python3
"""
Qoder/Tongyi Lingma preToolUse hook
Converts Qoder JSON input → unified format → calls agent-watch CLI → converts output back
"""

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLI_PATH = os.path.join(SCRIPT_DIR, '../../../cli/bin/agent-watch-hook.js')
GATEWAY_URL = os.getenv('AGENT_WATCH_APPROVE_GATEWAY', 'http://localhost:3000')


def fail_open():
    print(json.dumps({'permissionDecision': 'allow'}))
    sys.exit(0)


def fail_closed():
    print(json.dumps({'permissionDecision': 'deny'}))
    sys.exit(2)


def main():
    # Read stdin
    try:
        stdin_data = sys.stdin.read()
    except Exception:
        fail_open()

    if not stdin_data or not stdin_data.strip():
        fail_open()

    # Parse input
    try:
        input_data = json.loads(stdin_data.strip())
    except json.JSONDecodeError:
        fail_open()

    # Check for bypass
    if input_data.get('bypass') is True or input_data.get('permission_mode') == 'bypassPermissions':
        print(json.dumps({'permissionDecision': 'allow'}))
        sys.exit(0)

    # Extract fields
    tool_name = input_data.get('tool_name', '')
    tool_input = input_data.get('tool_input') or {}

    # Build unified input
    unified_input = {
        'agent': 'qoder',
        'tool_name': tool_name,
        'tool_input': tool_input,
        'cwd': input_data.get('cwd', os.getcwd()),
        'session_id': input_data.get('session_id', ''),
    }

    # Extract command from tool_input
    if 'command' in tool_input:
        unified_input['command'] = tool_input['command']
    elif 'path' in tool_input:
        unified_input['command'] = tool_input['path']

    # Call unified CLI via node
    try:
        result = subprocess.run(
            ['node', CLI_PATH, '--gateway', GATEWAY_URL],
            input=json.dumps(unified_input),
            capture_output=True,
            text=True,
            timeout=120,
        )
        cli_output = result.stdout.strip()
    except subprocess.TimeoutExpired:
        fail_closed()
    except FileNotFoundError:
        fail_closed()
    except Exception:
        fail_closed()

    # Parse CLI output
    if not cli_output:
        fail_closed()

    try:
        cli_result = json.loads(cli_output)
    except json.JSONDecodeError:
        fail_closed()

    decision = cli_result.get('decision', 'deny')
    exit_code = cli_result.get('exitCode', 2)

    # Convert to Qoder format
    if decision in ('allow', 'approve'):
        print(json.dumps({'permissionDecision': 'allow'}))
        sys.exit(0)
    else:
        print(json.dumps({'permissionDecision': 'deny'}))
        sys.exit(2)


if __name__ == '__main__':
    main()
