# 每日运行：抓取 -> 生成日报 -> 提交到 GitHub
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$env:GIT_TERMINAL_PROMPT = '0'

$logDir = Join-Path $PSScriptRoot '..\data'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'task.log'
function Say($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    Write-Host $line
}
Say "=== run start ==="

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

Say "[1/3] running monitor.js ..."
& $node monitor.js 2>&1 | ForEach-Object { Say "  $($_)" }
Say "monitor exit=$LASTEXITCODE"

Say "[2/3] committing ..."
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Say "nothing to commit"
} else {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    git commit -m "chore: price report $stamp" | Out-Null
    Say "committed: $(git log --oneline -1)"
}

Say "[3/3] pushing ..."
# token 来源：.github-token 文件（已 gitignore）优先，其次环境变量
$tokenFile = Join-Path $PSScriptRoot '..\.github-token'
$token = $null
if (Test-Path -LiteralPath $tokenFile) { $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim() }
if (-not $token -and $env:PRICE_WATCH_GITHUB_TOKEN) { $token = $env:PRICE_WATCH_GITHUB_TOKEN }

$remote = (git remote get-url origin 2>$null)
if ($token -and $remote -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+?)(\.git)?$') {
    $owner = $Matches['owner']; $repo = $Matches['repo']
    # 用一次性的带凭据 URL 推送，绝不写回 .git/config
    git push "https://x-access-token:$token@github.com/$owner/$repo.git" HEAD:main 2>&1 | ForEach-Object { Say "  git: $_" }
    Say "push exit=$LASTEXITCODE"
} else {
    Say "no token or non-github remote, trying plain push"
    git push origin HEAD:main 2>&1 | ForEach-Object { Say "  git: $_" }
    Say "push exit=$LASTEXITCODE"
}
Say "=== run end ==="

