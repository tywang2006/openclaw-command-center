#Requires -Version 5.1
<#
.SYNOPSIS
    OpenClaw Command Center - Windows First-Run Setup
.DESCRIPTION
    Interactive setup: language selection, password, .env, layout generation.
#>

$ErrorActionPreference = "Stop"

# Paths
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Join-Path $AppDir "node.exe"
$OpenClawHome = Join-Path $env:USERPROFILE ".openclaw"
$CmdDir = Join-Path $OpenClawHome "workspace\command-center"
$CmdPort = if ($env:CMD_PORT) { $env:CMD_PORT } else { "5100" }

# Colors
function Write-OK($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "  [XX] $msg" -ForegroundColor Red; exit 1 }
function Write-Info($msg) { Write-Host "  [ii] $msg" -ForegroundColor Cyan }

# i18n
$msgs = @{
    zh = @{
        title = "OpenClaw 指挥中心 — 首次设置"
        copying = "正在安装文件..."
        password_prompt = "设置访问密码（最少6位，留空使用默认: openclaw）"
        password_confirm = "确认密码"
        password_mismatch = "两次密码不一致，使用默认密码"
        password_ok = "密码已设置"
        env_create = "创建配置文件..."
        layout_gen = "生成办公室布局..."
        starting = "启动服务..."
        health_ok = "服务运行正常"
        health_fail = "服务可能仍在启动中"
        done = "安装完成！"
        url = "访问地址"
        password_label = "密码"
        relaunch = "请关闭此窗口，然后双击 launcher.bat 启动"
    }
    en = @{
        title = "OpenClaw Command Center — First-Run Setup"
        copying = "Installing files..."
        password_prompt = "Set access password (min 6 chars, empty for default: openclaw)"
        password_confirm = "Confirm password"
        password_mismatch = "Passwords don't match, using default"
        password_ok = "Password set"
        env_create = "Creating configuration..."
        layout_gen = "Generating office layout..."
        starting = "Starting service..."
        health_ok = "Service is running"
        health_fail = "Service may still be starting"
        done = "Setup Complete!"
        url = "Access URL"
        password_label = "Password"
        relaunch = "Close this window and double-click launcher.bat to launch"
    }
}

$lang = "en"

function T($key) { return $msgs[$lang][$key] }

# Banner
Write-Host ""
Write-Host @"
    ___                    ____ _
   / _ \ _ __   ___ _ __ / ___| | __ ___      __
  | | | | '_ \ / _ \ '_ \ |   | |/ _`` \ \ /\ / /
  | |_| | |_) |  __/ | | | |___| | (_| |\ V  V /
   \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/
        |_|
"@ -ForegroundColor DarkCyan
Write-Host ""

# Language selection
Write-Host "  Select Language / 请选择语言" -NoNewline -ForegroundColor White
Write-Host ""
Write-Host ""
Write-Host "    1) 中文" -ForegroundColor DarkCyan
Write-Host "    2) English" -ForegroundColor DarkCyan
Write-Host ""
$lc = Read-Host "  [1/2]"
if ($lc -ne "2" -and $lc -ne "en") { $lang = "zh" }

Write-Host ""
Write-Host "  $(T 'title')" -ForegroundColor DarkGray
Write-Host "  $('─' * 50)" -ForegroundColor DarkGray
Write-Host ""

# Check node.exe
if (-not (Test-Path $Node)) {
    Write-Err "node.exe not found at $Node"
}
Write-OK "Node.js found"

# Copy files
Write-Info "$(T 'copying')"
if (-not (Test-Path $CmdDir)) { New-Item -ItemType Directory -Path $CmdDir -Force | Out-Null }

$items = @("server", "dist", "scripts", "node_modules", "package.json", "ecosystem.config.cjs")
foreach ($item in $items) {
    $src = Join-Path $AppDir $item
    $dst = Join-Path $CmdDir $item
    if (Test-Path $src) {
        if ((Get-Item $src).PSIsContainer) {
            if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
            Copy-Item $src $dst -Recurse -Force
        } else {
            Copy-Item $src $dst -Force
        }
    }
}
Write-OK "$(T 'copying')"

# Password
Write-Host ""
Write-Info "$(T 'password_prompt')"
$pw1 = Read-Host "  >"
if ([string]::IsNullOrEmpty($pw1) -or $pw1.Length -lt 6) {
    $pw1 = "openclaw"
} else {
    $pw2 = Read-Host "  $(T 'password_confirm')"
    if ($pw1 -ne $pw2) {
        Write-Warn "$(T 'password_mismatch')"
        $pw1 = "openclaw"
    }
}
[System.IO.File]::WriteAllText((Join-Path $CmdDir ".auth_password"), $pw1)
Write-OK "$(T 'password_ok')"

# .env
Write-Info "$(T 'env_create')"
$ocToken = ""
$ocConfigPath = Join-Path $OpenClawHome "openclaw.json"
if (Test-Path $ocConfigPath) {
    try {
        $ocConfig = Get-Content $ocConfigPath -Raw | ConvertFrom-Json
        $ocToken = if ($ocConfig.authToken) { $ocConfig.authToken }
                   elseif ($ocConfig.token) { $ocConfig.token }
                   elseif ($ocConfig.auth -and $ocConfig.auth.token) { $ocConfig.auth.token }
                   else { "" }
    } catch { $ocToken = "" }
}

$envContent = @"
OPENCLAW_HOME=$OpenClawHome
CMD_PORT=$CmdPort
OPENCLAW_AUTH_TOKEN=$ocToken
"@
$envPath = Join-Path $CmdDir ".env"
if (-not (Test-Path $envPath)) {
    [System.IO.File]::WriteAllText($envPath, $envContent)
}
Write-OK ".env"

# Layout
Write-Info "$(T 'layout_gen')"
$genLayout = Join-Path $CmdDir "scripts\gen-layout.js"
if (Test-Path $genLayout) {
    & $Node $genLayout 2>$null | Out-Null
}

# Mark setup done
"" | Out-File (Join-Path $CmdDir ".setup-done") -NoNewline

# Start server
Write-Info "$(T 'starting')"
$serverJs = Join-Path $CmdDir "server\index.js"
$proc = Start-Process -FilePath $Node -ArgumentList $serverJs -WorkingDirectory $CmdDir -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 3
try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:${CmdPort}/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($health.Content -match '"status":"ok"') {
        Write-OK "$(T 'health_ok')"
    } else {
        Write-Warn "$(T 'health_fail')"
    }
} catch {
    Write-Warn "$(T 'health_fail')"
}

# Open browser
Start-Process "http://localhost:${CmdPort}/cmd/"

# Done
$password = Get-Content (Join-Path $CmdDir ".auth_password") -ErrorAction SilentlyContinue
if (-not $password) { $password = "openclaw" }
Write-Host ""
Write-Host "  $('━' * 50)" -ForegroundColor DarkCyan
Write-Host "  $(T 'done')" -ForegroundColor DarkCyan
Write-Host "  $('━' * 50)" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  $(T 'url'):  " -NoNewline; Write-Host "http://localhost:${CmdPort}/cmd/" -ForegroundColor Green
Write-Host "  $(T 'password_label'):  " -NoNewline; Write-Host "$password" -ForegroundColor Cyan
Write-Host ""
Write-Host "  $(T 'relaunch')" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  Press Enter to close"

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
