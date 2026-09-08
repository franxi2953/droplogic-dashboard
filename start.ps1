param(
    [switch]$Open,
    [switch]$Proxy
)

Set-Location $PSScriptRoot

$url = "http://127.0.0.1:8787"

function Stop-ProcessTree {
    param([int]$ProcessId)
    $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $ProcessId }
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
}

function Stop-ExistingDashboardProcesses {
    $processIds = [System.Collections.Generic.HashSet[int]]::new()

    # The dashboard and proxy own these ports. Killing their trees also stops
    # any DropLogic MCP child started by the proxy.
    $owners = Get-NetTCPConnection -LocalPort 8787,8788,8789 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -ne 0 }
    foreach ($owner in $owners) {
        [void]$processIds.Add([int]$owner)
    }

    # A stdio MCP process may not own a TCP port. Include only recognizable
    # dashboard/MCP entry points, never every Python process on the machine.
    $knownProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ProcessId -ne $PID -and
            [string]$_.CommandLine -match '(?i)(backend[\\/]server\.py|backend[\\/]mcp_proxy\.py|droplogic\.mcp\.server|droplogic-mcp)'
        }
    foreach ($process in $knownProcesses) {
        [void]$processIds.Add([int]$process.ProcessId)
    }

    foreach ($processId in $processIds) {
        try {
            Stop-ProcessTree -ProcessId $processId
        } catch {
            Write-Warning "Could not stop dashboard/MCP process $processId. Run PowerShell as Administrator if it is still running."
        }
    }
    $remainingOwners = Get-NetTCPConnection -LocalPort 8787,8788,8789 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -ne 0 }
    foreach ($owner in $remainingOwners) {
        Write-Warning "Port cleanup failed for process $owner. Run PowerShell as Administrator before starting the dashboard."
    }
    if ($processIds.Count -gt 0) {
        Start-Sleep -Milliseconds 800
    }
}

Stop-ExistingDashboardProcesses

if ($Open) {
    Start-Process $url
}

if ($Proxy) {
    py -3.13 backend\mcp_proxy.py
} else {
    py -3.13 backend\server.py
}
