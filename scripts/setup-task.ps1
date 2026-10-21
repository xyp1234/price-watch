# 注册 Windows 每日定时任务（默认 08:30）
# 用 schtasks 而非 Register-ScheduledTask，普通用户权限即可，不需要管理员。
param(
    [string]$Time = '08:30',
    [string]$TaskName = 'PriceWatch Daily'
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'daily.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw "daily.ps1 not found: $script" }

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# 先删旧的，忽略不存在的报错
schtasks /Delete /TN "$TaskName" /F 2>&1 | Out-Null

schtasks /Create /TN "$TaskName" /TR "$cmd" /SC DAILY /ST $Time /F
if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed with exit code $LASTEXITCODE" }

Write-Host "task '$TaskName' registered, runs daily at $Time" -ForegroundColor Green
schtasks /Query /TN "$TaskName" /FO LIST | Select-String -Pattern 'TaskName|Next Run|Status|Schedule Type'
