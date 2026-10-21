# 注册 Windows 每日定时任务（默认 08:30）
param(
    [string]$Time = '08:30',
    [string]$TaskName = 'PriceWatch Daily'
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'daily.ps1'

if (-not (Test-Path -LiteralPath $script)) { throw "daily.ps1 not found: $script" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
    -WorkingDirectory (Split-Path -Parent (Split-Path -Parent $script))

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# 即使没有登录也运行
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType S4U

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "task '$TaskName' registered, runs daily at $Time" -ForegroundColor Green
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
