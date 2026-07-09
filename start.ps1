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
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not $Proxy) {
    $owners = Get-NetTCPConnection -LocalPort 8787,8788,8789 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -ne 0 }
    foreach ($owner in $owners) {
        Stop-ProcessTree -ProcessId $owner
    }
    if ($owners) {
        Start-Sleep -Milliseconds 800
    }
}

if ($Open) {
    Start-Process $url
}

if ($Proxy) {
    py -3.13 backend\mcp_proxy.py
} else {
    py -3.13 backend\server.py
}
