# Trae IDE 双层拦截方案

> **版本**: 1.0
> **日期**: 2026-06-15
> **适用**: Trae IDE (字节跳动) - v1.0+

---

## 1. 为什么需要双层拦截

Trae IDE **目前没有官方 lifecycle Hook API**（[Feature Request #2436](https://github.com/Trae-AI/TRAE/issues/2436) 仍未实现），意味着我们**不能像 Claude Code / Cursor 那样**通过 Trae 自身的 Hook 机制拦截 AI 操作。

但 Trae 的 AI Agent **有两种执行危险操作的路径**：

| 路径 | 例子 | 默认是否被拦截 |
|------|------|--------------|
| **MCP 工具调用** | Agent 调用 `mcp__filesystem__delete_file` | ❌ 直接执行 |
| **原生 Shell 执行** | Agent 用 `BashTool` 跑 `rm -rf node_modules` | ❌ 直接执行 |

任何**单层方案都有盲区**。我们用**两层独立拦截**做到**零盲区**。

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  Trae IDE                                                       │
│                                                                  │
│  AI Agent 想执行危险操作                                          │
│       │                                                          │
│       ├── 路径 A: MCP 工具调用                                   │
│       │      ↓                                                    │
│       │   trae-mcp-proxy.mjs (MCP 层)                            │
│       │      ↓ 识别 destructiveHint + 命令模式                    │
│       │   危险？                                                 │
│       │      ├─ 否 → 直接转发到 MCP server                       │
│       │      └─ 是 → POST /v1/approvals → Gateway                │
│       │                       ↓                                  │
│       │                     飞书卡片 (user 决策)                  │
│       │                       ↓                                  │
│       │                     approve?                             │
│       │                       ├─ yes → 真正执行工具               │
│       │                       └─ no  → 返回错误给 Agent          │
│       │                                                          │
│       └── 路径 B: 原生 Shell                                      │
│              ↓                                                    │
│           Trae 启动子进程 (powershell.exe / cmd.exe)              │
│              ↓                                                    │
│           trae-process-monitor.ps1 (进程层)                       │
│              WMI 监控 → 检测危险命令                              │
│              危险？                                               │
│                ├─ 否 → 放行                                      │
│                └─ 是 → POST /v1/approvals → Gateway              │
│                          ↓                                        │
│                        飞书卡片 (user 决策)                        │
│                          ↓                                        │
│                        approve?                                   │
│                          ├─ yes → 放行进程继续执行                │
│                          └─ no  → Stop-Process 终止子进程        │
└──────────────────────────────────────────────────────────────────┘
```

**两条路**:
- 互不依赖（MCP 拦 MCP，进程层拦 Shell）
- 共用同一个 Gateway API
- 飞书卡片里都标 `Agent=Trae` (路径区分见卡片)

---

## 3. 快速安装

### 3.1 前置条件

1. **Gateway 已启动**（`localhost:3000`，参考 README）
2. **Trae IDE 已安装**（任意平台）
3. **Windows 用户**：PowerShell 5.1+（Win10/11 自带）

### 3.2 一键安装

```bash
cd "d:\Desktop\watch agent\agent-watch-approve"
pnpm install

# 安装 Trae 双层拦截
cd packages/gateway
npx tsx -e "
import { TraeAdapter } from './src/agents/trae.adapter';
const adapter = new TraeAdapter();
adapter.install({
  gatewayUrl: 'http://localhost:3000',
  userId: 'test-user',
  approvalTimeout: 300,
}).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

输出示例：
```json
{
  "success": true,
  "configPath": "C:\\Users\\xxx\\.trae\\mcp.json",
  "hookCommand": "trae-mcp-proxy + trae-process-monitor",
  "details": {
    "mcp": { "success": true, "configPath": "...", "backupPath": "..." },
    "processMonitor": { "installed": true, "path": "...\\trae-process-monitor.ps1" }
  }
}
```

### 3.3 验证安装

```bash
# 在 PowerShell 中运行
powershell -ExecutionPolicy Bypass -File "d:\Desktop\watch agent\agent-watch-approve\packages\gateway\src\agents\hooks\trae-process-monitor.ps1" -GatewayUrl "http://localhost:3000" -UserId "test-user"
```

预期输出：
```
[HH:MM:SS.mmm] [INFO] 进程监控启动
[HH:MM:SS.mmm] [INFO] ETW 监控运行中，按 Ctrl+C 停止...
[HH:MM:SS.mmm] [INFO] 监控 SessionId: xxxxxxxx
```

### 3.4 测试拦截

在 Trae 中让 AI 执行：
```
请用 MCP filesystem 工具删除 /tmp/test-important-file.txt
```

**预期**：
1. 飞书收到卡片（`Agent=Trae` `工具=filesystem__delete_file`）
2. 等待 5 分钟（或点拒绝）
3. 若拒绝 → 文件未删除，AI 收到错误信息
4. 若通过 → 文件被删除

在 Trae 中让 AI 执行 Shell：
```
请运行 rm -rf /tmp/test-dir
```

**预期**：
1. 飞书收到卡片（`Agent=Trae` `工具=shell` `命令=rm -rf /tmp/test-dir`）
2. 若拒绝 → 进程被终止，目录未删除
3. 若通过 → 目录被删除

---

## 4. 详细组件说明

### 4.1 trae-mcp-proxy.mjs

**位置**: `packages/gateway/src/agents/trae-mcp-proxy.mjs`

**职责**: 拦截 MCP 工具调用

**实现要点**：
- 零外部依赖（纯 Node.js 内置模块）
- 实现 MCP JSON-RPC 协议（initialize / tools/list / tools/call / ping）
- `tools/list` 时**注入 `destructiveHint` 注解**让 Trae 自己显示警告
- `tools/call` 时按工具名 + 参数模式判断是否危险
- 危险操作 → POST Gateway → 轮询状态 → 执行/拒绝

**危险工具检测**（`isDangerousTool`）：
```js
const patterns = [
  /delete/i, /remove/i, /destroy/i, /drop/i,
  /exec/i, /run.*script/i, /shell/i, /bash/i,
  /kill/i, /terminate/i,
  /write.*file/i, /create.*file/i,
  /git.*push/i, /git.*force/i,
  /database.*write/i, /env.*set/i,
];
```

**危险参数检测**（`isDangerousArgs`）：
- 递归删除（`recursive: true`）
- 强制覆盖（`force: true`）
- 系统关键路径（`.git/config`、`/etc/passwd`、`system32`）

### 4.2 trae-process-monitor.ps1

**位置**: `packages/gateway/src/agents/hooks/trae-process-monitor.ps1`

**职责**: 监控 Trae 启动的子进程（Shell）

**实现要点**：
- WMI `__InstanceCreationEvent` 事件订阅（1 秒轮询）
- 过滤：父进程 = Trae/Electron 的 `powershell.exe` / `cmd.exe` / `node.exe`
- 12 种危险命令模式（`rm -rf`、磁盘格式化、注册表、`git push --force`、pipe-to-shell 等）
- 危险 → POST Gateway → 轮询 → 通过则放行，拒绝则 `Stop-Process -Force`

**危险命令模式**：
```powershell
$DANGEROUS_PATTERNS = @(
  "rm -rf", "format c:", "git push --force", "git reset --hard",
  "taskkill /F", "DROP TABLE", "Stop-Process -Force",
  "curl | sh", "Set-ExecutionPolicy Unrestricted", ...
)
```

**为什么不用 ETW 而是 WMI？**
- ETW 需要管理员权限 + manifest provider
- WMI 普通用户就能用，1 秒精度对审批场景足够
- Windows 自带 PowerShell 5.1 + WMI 兼容，零依赖

### 4.3 TraeAdapter

**位置**: `packages/gateway/src/agents/trae.adapter.ts`

**职责**: 协调两层 Hook 的安装/卸载/测试

**API 实现**：
- `install(config)` → 调 `installMcpLayer` + `installProcessMonitor`
- `uninstall()` → 还原 `mcp.json` + 终止监控进程
- `testHook()` → 检查 `mcp.json` 是否包装 + PowerShell 进程是否运行

---

## 5. 配置示例

### 5.1 Trae MCP 配置文件

文件位置：
- **Windows**: `%APPDATA%\Trae\User\mcp.json`
- **macOS**: `~/Library/Application Support/Trae/User/mcp.json`
- **Linux**: `~/.config/Trae/User/mcp.json`

Agent Watch 安装后：
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": [
        "d:\\Desktop\\watch agent\\agent-watch-approve\\packages\\gateway\\src\\agents\\trae-mcp-proxy.mjs",
        "--gateway", "http://localhost:3000",
        "--user", "test-user",
        "--approve-timeout", "300",
        "--",
        "npx", "--yes", "@modelcontextprotocol/server-filesystem", "/project"
      ]
    }
  }
}
```

### 5.2 进程监控命令行

```powershell
powershell -ExecutionPolicy Bypass -File trae-process-monitor.ps1 `
  -GatewayUrl "http://localhost:3000" `
  -UserId "test-user" `
  -SessionId "custom-session-id" `  # 可选，默认自动生成
  -ApproveTimeoutSeconds 300 `
  -Debug  # 开启调试
```

---

## 6. 卸载

```bash
# MCP 层 + 进程层都卸载
node -e "
import('./src/agents/trae.adapter.js').then(({ TraeAdapter }) => {
  new TraeAdapter().uninstall().then(r => console.log(r));
});
"
```

或手动：
1. 还原 `mcp.json` 备份
2. 终止所有 `trae-process-monitor` PowerShell 进程

---

## 7. 故障排查

### 7.1 MCP Proxy 启动失败

**症状**: Trae 启动后 MCP server 加载失败

**检查**:
```bash
# 直接运行测试
node trae-mcp-proxy.mjs --gateway http://localhost:3000 --user test -- npx --yes @modelcontextprotocol/server-everything
```

**常见问题**:
- Node 版本 < 18 → 升级
- Gateway URL 错 → 检查 Gateway 启动
- `--` 后必须跟非空命令

### 7.2 进程监控捕获不到

**症状**: Trae 执行 `rm -rf` 没拦截，进程不被监控

**检查**:
```powershell
# 看监控是否在跑
Get-Process | Where-Object { $_.CommandLine -match "trae-process-monitor" }

# 看 Trae 的子进程
Get-WmiObject -Class Win32_Process -Filter "ParentProcessId = $(Get-Process trae | Select-Object -First 1 -ExpandProperty Id)" | Select-Object Name, ProcessId, CommandLine
```

**常见问题**:
- Trae 进程名不匹配 → 修改 `trae-process-monitor.ps1` 里的父进程匹配规则
- 父进程没拿到权限 → 用管理员运行 Gateway（监控本身不要管理员）
- WMI 服务被禁用 → `sc config Winmgmt start= auto`

### 7.3 飞书卡片只显示来源不显示命令

**症状**: 卡片上 command 字段空

**原因**: MCP proxy 提交审批时 `command` 字段没填

**修复**: `trae-mcp-proxy.mjs` 的 `requestApproval` 已经传 `arguments`，但 shared 类型需要包含，参考 `packages/shared/src/approval.ts`。

### 7.4 进程监控误杀正常命令

**症状**: 正常 `git status` 被拦截

**修复**: 编辑 `trae-process-monitor.ps1` 的 `$DANGEROUS_PATTERNS` 调整正则。

---

## 8. 安全性

### 8.1 防护范围

| 攻击向量 | MCP 层 | 进程层 | 总防护 |
|---------|--------|--------|--------|
| 删除文件（MCP） | ✅ | — | ✅ |
| 删文件（PowerShell rm -rf） | — | ✅ | ✅ |
| 写文件（MCP） | ✅ | — | ✅ |
| 写文件（echo > file） | — | ✅ | ✅ |
| 强制 git push | ✅（git push 工具） | ✅（git 命令） | ✅ |
| 数据库 DROP（MCP） | ✅ | — | ✅ |
| 数据库 DROP（psql） | — | ✅ | ✅ |

### 8.2 已知限制

1. **Trae 升级可能改父进程名**：监控匹配规则可能需要更新
2. **极快命令竞态**：命令已执行完才检测到（无法 100% 阻止，但日志可回溯）
3. **无 GUI 命令覆盖不全**：12 种模式基于经验，可根据需要补充
4. **Linux/macOS 进程层未实现**：当前仅 Windows（`Stop-Process` 是 Windows API）

### 8.3 失败-安全 (Fail-Safe)

- Gateway 不可达 → **拒绝**（deny by default）
- 监控进程崩溃 → 用户可在 Dashboard 看到事件 + 日志
- 审批超时 → 5 分钟后自动拒绝

---

## 9. 未来工作

- [ ] macOS `endpoint-security` 进程监控（需要 entitlement）
- [ ] Linux `auditd` 进程监控
- [ ] 进程层检测 + ETW 高精度版本（admin only）
- [ ] Trae 官方 Hook 出来后切换到原生实现
- [ ] 危险模式 ML 学习（基于用户过去决策）

---

## 10. 参考资料

- [Trae Feature Request #2436](https://github.com/Trae-AI/TRAE/issues/2436) - lifecycle hooks
- [MCP Specification](https://modelcontextprotocol.io/) - JSON-RPC 协议
- [WMI Events](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmi-events) - 进程监控
- [Pointend Hook Proposal](https://forum.trae.cn/t/topic/18062) - 社区 beforeToolCall 提案
- 原始 PoC: [Huan-zhaojun/mcp-safe-proxy](https://github.com/Huan-zhaojun/mcp-safe-proxy)

---

*文档版本: 1.0 | 最后更新: 2026-06-15*
