# 每日运行：抓取 -> 生成日报 -> 提交到 GitHub
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot\..

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

Write-Host "[1/3] running monitor.js ..."
& $node monitor.js
$code = $LASTEXITCODE
if ($code -ne 0) { Write-Host "monitor.js failed with exit code $code" -ForegroundColor Red }

Write-Host "[2/3] committing ..."
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "nothing to commit"
} else {
    $stamp = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    git commit -m "chore: price report $stamp"
}

Write-Host "[3/3] pushing ..."
# 若配置了 token（.github-token 文件或 PRICE_WATCH_GITHUB_TOKEN 环境变量），用带凭据的 URL 推送
$tokenFile = Join-Path $PSScriptRoot '..\.github-token'
$token = $null
if (Test-Path -LiteralPath $tokenFile) { $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim() }
if (-not $token -and $env:PRICE_WATCH_GITHUB_TOKEN) { $token = $env:PRICE_WATCH_GITHUB_TOKEN }

if ($token) {
    $remote = (git remote get-url origin 2>$null)
    if ($remote -and $remote -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)') {
        $owner = $Matches['owner']; $repo = $Matches['repo']
        git push "https://x-access-token:$token@github.com/$owner/$repo.git" HEAD:main
        if ($LASTEXITCODE -eq 0) {
            # 恢复无凭据的 remote，避免 token 残留在 .git/config
            git remote set-url origin "https://github.com/$owner/$repo.git"
            Write-Host "pushed OK" -ForegroundColor Green
        }
    } else {
        git push origin HEAD:main
    }
} else {
    Write-Host "no token found (.github-token / PRICE_WATCH_GITHUB_TOKEN), pushing with stored credentials"
    git push origin HEAD:main
}
