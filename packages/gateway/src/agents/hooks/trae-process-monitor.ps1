#Requires -Version 5.1
<#
.SYNOPSIS
    Trae Process Monitor - monitors Trae IDE Shell child processes for approval

.DESCRIPTION
    Uses WMI event subscription to monitor new process creation in real time.
    Filters to Trae child processes (PowerShell/cmd.exe), detects dangerous
    command patterns, and forwards to Gateway for approval. Approve = pass through.
    Deny/timeout = Stop-Process.

.EXAMPLE
    .\trae-process-monitor.ps1

.EXAMPLE
    .\trae-process-monitor.ps1 -GatewayUrl "http://localhost:3000" -UserId "dev-001"
#>

param(
    [string]$GatewayUrl = 'http://localhost:3000',
    [string]$UserId = 'default',
    [string]$SessionId = '',
    [int]$ApproveTimeoutSeconds = 300,
    [switch]$Debug,
    [switch]$Install,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
$AGENT = 'Trae-ProcessMonitor'
$VERSION = '1.0.0'

if (-not $SessionId) {
    $SessionId = [guid]::NewGuid().ToString('N')
}

# Dangerous command patterns (PowerShell-style)
$DANGEROUS_PATTERNS = @(
    # Recursive delete
    @{ Pattern = 'rm\s+-rf|Remove-Item.*-Recurse|del\s+/[sfq]|rd\s+/[sd]';
       Reason = 'Recursive delete' },
    # Format
    @{ Pattern = 'format\s+[a-z]:|Format-Volume';
       Reason = 'Disk format' },
    # System permission change
    @{ Pattern = 'chmod\s+777|icacls.*grant|New-Item.*-Path.*System32';
       Reason = 'System permission change' },
    # Git force ops
    @{ Pattern = 'git\s+push\s+.*--force|git\s+push\s+.*-f|git\s+force\s+push';
       Reason = 'Git force push' },
    # Git hard reset
    @{ Pattern = 'git\s+reset\s+--hard|git\s+reset\s+--merge';
       Reason = 'Git hard reset' },
    # Package manager force
    @{ Pattern = 'npm\s+exec.*rm|npx.*rm|yarn\s+remove.*--force|pip\s+uninstall.*-y';
       Reason = 'Package manager force op' },
    # Kill process
    @{ Pattern = 'taskkill\s+/[ft]|Stop-Process.*-Force|kill\s+-(9|sigkill)';
       Reason = 'Force kill process' },
    # Network pipe-to-shell
    @{ Pattern = 'curl.*\|.*sh|wget.*\|.*sh|iex\s+\(.*\)';
       Reason = 'Pipe to shell risk' },
    # Database danger
    @{ Pattern = 'DROP\s+TABLE|DROP\s+DATABASE|DELETE\s+FROM.*WHERE\s+1=1';
       Reason = 'Database danger op' },
    # Docker danger
    @{ Pattern = 'docker\s+rm\s+-(f|force)|docker\s+system\s+prune|docker\s+volume\s+rm';
       Reason = 'Docker danger op' },
    # Registry danger
    @{ Pattern = 'reg\s+(add|delete).*[/\\]?f\s+HKLM|regedit.*/s.*\.reg';
       Reason = 'Registry danger op' },
    # PowerShell danger
    @{ Pattern = 'Set-ExecutionPolicy.*Unrestricted|Invoke-Expression.*http';
       Reason = 'PowerShell danger policy' }
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
function Write-Log {
    param([string]$Level = 'INFO', [string]$Message, [hashtable]$Meta = @{})
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    $metaStr = if ($Meta.Count -gt 0) { " $($Meta | ConvertTo-Json -Compress)" } else { '' }
    $line = "[$ts] [$Level] $Message$metaStr"
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'DEBUG' { if ($Debug) { Write-Host $line -ForegroundColor DarkGray } }
        default { Write-Host $line }
    }
}

# ---------------------------------------------------------------------------
# Gateway HTTP helpers
# ---------------------------------------------------------------------------
function Invoke-GatewayRequest {
    param(
        [string]$Path,
        [string]$Method = 'POST',
        [object]$Body = $null
    )

    try {
        $uri = [System.Uri]::new("$GatewayUrl$Path")
        $req = [System.Net.HttpWebRequest]::Create($uri)
        $req.Method = $Method
        $req.ContentType = 'application/json'
        $req.UserAgent = "$AGENT/$VERSION"
        $req.Timeout = 15000
        $req.Headers['X-Session-Id'] = $SessionId

        if ($Body) {
            $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
            $req.ContentLength = $bodyBytes.Length
            $req.GetRequestStream().Write($bodyBytes, 0, $bodyBytes.Length)
        } else {
            $req.ContentLength = 0
        }

        $resp = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $content = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()

        return $content | ConvertFrom-Json
    }
    catch {
        Write-Log 'ERROR' "Gateway request failed: $($_.Exception.Message)" @{ Path = $Path }
        return $null
    }
}

function Get-GatewayApprovalStatus {
    param([string]$ApprovalId)

    try {
        $uri = [System.Uri]::new("$GatewayUrl/v1/approvals/$ApprovalId/status")
        $req = [System.Net.HttpWebRequest]::Create($uri)
        $req.Method = 'GET'
        $req.UserAgent = "$AGENT/$VERSION"
        $req.Timeout = 5000
        $req.Headers['X-Session-Id'] = $SessionId

        $resp = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $content = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()

        return $content | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# Danger detection
# ---------------------------------------------------------------------------
function Test-CommandDangerous {
    param([string]$Command)

    foreach ($rule in $DANGEROUS_PATTERNS) {
        if ($Command -match $rule.Pattern) {
            return @{ Dangerous = $true; Reason = $rule.Reason; Pattern = $rule.Pattern }
        }
    }
    return @{ Dangerous = $false; Reason = $null }
}

# ---------------------------------------------------------------------------
# Approval flow
# ---------------------------------------------------------------------------
function Wait-ForApproval {
    param(
        [string]$Command,
        [string]$Reason,
        [int]$TimeoutSeconds = 300
    )

    $approvalId = [guid]::NewGuid().ToString('N')
    Write-Log 'WARN' 'Dangerous command detected, waiting for approval...' @{
        ApprovalId = $approvalId
        Reason = $Reason
        Command = $Command.Substring(0, [Math]::Min(80, $Command.Length))
    }

    $body = @{
        sessionId    = $SessionId
        approvalType = 'exec_approval'
        toolName     = 'shell'
        command      = $Command
        justification = $Reason
        riskLevel    = 'high'
        timeoutSeconds = $TimeoutSeconds
        status       = 'pending'
    } | ConvertTo-Json -Compress

    $result = Invoke-GatewayRequest -Path '/v1/approvals' -Method 'POST' -Body $body

    if (-not $result) {
        Write-Log 'ERROR' 'Cannot reach gateway, blocking execution'
        return 'deny'
    }

    # Poll approval status
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $pollMs = 1500

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds $pollMs

        $status = Get-GatewayApprovalStatus -ApprovalId $approvalId
        if (-not $status) {
            continue
        }

        if ($status.status -eq 'approved') {
            Write-Log 'INFO' 'Approval received' @{ ApprovalId = $approvalId }
            return 'approve'
        }
        if ($status.status -eq 'denied') {
            Write-Log 'WARN' 'Approval denied' @{ ApprovalId = $approvalId }
            return 'deny'
        }
        if ($status.status -eq 'timeout') {
            Write-Log 'WARN' 'Approval timeout' @{ ApprovalId = $approvalId }
            return 'timeout'
        }
    }

    Write-Log 'WARN' 'Approval timeout (no response)' @{ ApprovalId = $approvalId }
    return 'timeout'
}

# ---------------------------------------------------------------------------
# Process Monitor using WMI ManagementEventWatcher
# ---------------------------------------------------------------------------
function Start-ProcessMonitor {
    Write-Log 'INFO' 'Process monitor started' @{
        Gateway = $GatewayUrl
        UserId  = $UserId
        SessionId = $SessionId
    }

    Add-Type -AssemblyName System.Management

    # WMI event query: subscribe to all new process creation
    $query = New-Object System.Management.WqlEventQuery(
        '__InstanceCreationEvent',
        1,
        "TargetInstance ISA 'Win32_Process'"
    )

    $watcher = New-Object System.Management.ManagementEventWatcher($query)

    $action = {
        param([System.Management.BaseEvent]$e)

        try {
            $proc = $e.Properties['TargetInstance'].Value
            $procName = $proc.Properties['Name'].Value
            $cmdLine  = $proc.Properties['CommandLine'].Value
            $ppid     = $proc.Properties['ParentProcessId'].Value
            $pid      = $proc.Properties['ProcessId'].Value

            if (-not $cmdLine) { return }

            # Only target Trae child processes
            $isTarget = $procName -match '^(powershell|pwsh|cmd|node)\.exe$'
            if (-not $isTarget) { return }

            # Check parent process name
            try {
                $parentProc = Get-Process -Id $ppid -ErrorAction SilentlyContinue
                if (-not $parentProc) { return }
                $parentName = $parentProc.ProcessName
                $isTraeChild = $parentName -match '(electron|trae|Trae|code)' -or $ppid -eq $PID
            }
            catch {
                return
            }

            if (-not $isTraeChild) { return }

            Write-Log 'DEBUG' 'Trae child process detected' @{
                ProcessName = $procName
                PID = $pid
                Parent = $parentName
                CommandLine = $cmdLine.Substring(0, [Math]::Min(120, $cmdLine.Length))
            }

            # Check if dangerous
            $check = Test-CommandDangerous -Command $cmdLine
            if ($check.Dangerous) {
                Write-Log 'WARN' 'Dangerous command blocked!' @{
                    PID = $pid
                    Reason = $check.Reason
                    Command = $cmdLine
                }

                $decision = Wait-ForApproval -Command $cmdLine -Reason $check.Reason -TimeoutSeconds $ApproveTimeoutSeconds

                if ($decision -ne 'approve') {
                    Write-Log 'WARN' "Killing process PID=$pid" @{}
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                    return
                }
            }
        }
        catch {
            Write-Log 'ERROR' "Event handler error: $($_.Exception.Message)" @{}
        }
    }

    $watcher.EventArrived += $action
    $watcher.Start()

    Write-Log 'INFO' 'Monitor running. Press Ctrl+C to stop...'
    Write-Log 'INFO' "Session: $SessionId"

    try {
        while ($true) {
            Start-Sleep -Seconds 5
        }
    }
    finally {
        $watcher.Stop()
        $watcher.Dispose()
        Write-Log 'INFO' 'Process monitor stopped'
    }
}

# ---------------------------------------------------------------------------
# Install / Uninstall
# ---------------------------------------------------------------------------
function Install-Monitor {
    $profilePath = $PROFILE.AllUsersAllHosts
    $marker = '# === Agent Watch Trae Monitor ==='

    $installBlock = @"
$marker
# Auto-start Agent Watch monitor when PowerShell opens
`$env:AGENT_WATCH_APPROVE_SESSION_ID = '$SessionId'
try {
    `$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy','Bypass','-File',`"`$PSScriptRoot\trae-process-monitor.ps1`",'-GatewayUrl','$GatewayUrl','-UserId','$UserId','-SessionId',`"`$env:AGENT_WATCH_APPROVE_SESSION_ID`",'-ApproveTimeoutSeconds','$ApproveTimeoutSeconds' -PassThru -WindowStyle Hidden
    Write-Host '[Agent Watch Approve] Monitor started (PID: '`$proc.Id')'
} catch {
    Write-Host '[Agent Watch Approve] Monitor start failed: '`$($_.Exception.Message)
}
# === /Agent Watch ===
"@

    Write-Log 'INFO' 'Installing Trae process monitor to PowerShell Profile...' @{
        Profile = $profilePath
    }

    $dir = Split-Path $profilePath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    if (Test-Path $profilePath) {
        $content = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
        if ($content -and $content.Contains($marker)) {
            Write-Log 'WARN' 'Installation marker exists, skipping'
            return
        }
        Add-Content -Path $profilePath -Value "`n$installBlock"
    }
    else {
        Set-Content -Path $profilePath -Value $installBlock
    }

    Write-Log 'INFO' 'Install complete. PowerShell will auto-start monitor on launch.'
}

function Uninstall-Monitor {
    $profilePath = $PROFILE.AllUsersAllHosts
    $marker = '# === Agent Watch Trae Monitor ==='

    if (Test-Path $profilePath) {
        $lines = Get-Content $profilePath
        $newLines = @()
        $skipBlock = $false

        foreach ($line in $lines) {
            if ($line -match [regex]::Escape($marker)) {
                $skipBlock = $true
                continue
            }
            if ($skipBlock -and $line -match '^# === /Agent Watch ===') {
                $skipBlock = $false
                continue
            }
            if (-not $skipBlock) {
                $newLines += $line
            }
        }

        Set-Content -Path $profilePath -Value $newLines
        Write-Log 'INFO' 'Removed monitor from PowerShell Profile'
    }

    # Stop running monitor processes
    Get-Process | Where-Object {
        $_.CommandLine -match 'trae-process-monitor'
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Log 'INFO' 'Stopped all monitor processes'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "Trae Process Monitor v$VERSION" -ForegroundColor Cyan
Write-Host "Session: $SessionId"
Write-Host ''

if ($Install) {
    Install-Monitor
    exit 0
}

if ($Uninstall) {
    Uninstall-Monitor
    exit 0
}

Start-ProcessMonitor
