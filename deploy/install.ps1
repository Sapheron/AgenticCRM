# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║          OpenAgent CRM — Windows Installer (PowerShell)                    ║
# ║          https://openagentcrm.sapheron.com                                  ║
# ║                                                                              ║
# ║  Run:  powershell -c "irm https://openagentcrm.sapheron.com/install.ps1 | iex"║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Config ────────────────────────────────────────────────────────────────────
$InstallDir   = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "C:\openagentcrm" }
$RepoUrl      = if ($env:REPO_URL)    { $env:REPO_URL    } else { "https://github.com/Sapheron/Open-Agent-CRM.git" }
$ComposeFile  = "$InstallDir\deploy\docker-compose.yml"
$TotalSteps   = 8

# ── Helpers ───────────────────────────────────────────────────────────────────
function Step($n, $msg)  { Write-Host "`n[STEP $n/$TotalSteps] $msg" -ForegroundColor Cyan }
function Ok($msg)        { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg)      { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Info($msg)      { Write-Host "  --> $msg" -ForegroundColor Blue }
function Fail($msg)      { Write-Host "`n  [ERROR] $msg" -ForegroundColor Red; exit 1 }

function RandHex([int]$bytes = 32) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $buf = New-Object byte[] $bytes
  $rng.GetBytes($buf)
  return ([System.BitConverter]::ToString($buf) -replace '-').ToLower()
}

function AskSkip($msg) {
  Ok "Already done: $msg"
  if ($env:CI -eq "true" -or $env:FORCE -eq "true") { return $true }
  $choice = Read-Host "  Skip this step? [Y/n]"
  return ($choice -eq "" -or $choice -match "^[Yy]")
}

# ── Banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        OpenAgent CRM — Installer v1.0            ║" -ForegroundColor Cyan
Write-Host "  ║    WhatsApp AI CRM  •  Self-hosted  •  Windows   ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Info "Install dir: $InstallDir"
Info "Repo:        $RepoUrl"
Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# STEP 1 — OS CHECK
# ════════════════════════════════════════════════════════════════════════════
Step 1 "Operating system"

$WinVer = [System.Environment]::OSVersion.Version
$WinName = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").ProductName
Ok "OS: $WinName (Build $($WinVer.Build))"

if ($WinVer.Major -lt 10) {
  Fail "Windows 10 or later is required."
}

# WSL2 check
$WslInstalled = (Get-Command wsl -ErrorAction SilentlyContinue) -ne $null
if (-not $WslInstalled) {
  Warn "WSL2 not found — OpenAgent CRM runs best on WSL2"
  $installWsl = Read-Host "  Install WSL2 now? [Y/n]"
  if ($installWsl -eq "" -or $installWsl -match "^[Yy]") {
    Info "Installing WSL2..."
    wsl --install
    Ok "WSL2 installed — please restart your computer, then re-run this installer"
    exit 0
  }
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 2 — DOCKER
# ════════════════════════════════════════════════════════════════════════════
Step 2 "Docker Desktop"

$DockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($DockerCmd) {
  $DockerVer = (docker --version) -replace "Docker version ", "" -replace ",.*", ""
  if (AskSkip "Docker $DockerVer is installed") {
    Ok "Using Docker $DockerVer"
  }
} else {
  Info "Docker not found — downloading Docker Desktop installer..."
  $Installer = "$env:TEMP\DockerDesktopInstaller.exe"
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $Installer
  Info "Running Docker Desktop installer (this may take a few minutes)..."
  Start-Process -Wait -FilePath $Installer -ArgumentList "install --quiet"
  Remove-Item $Installer -Force

  # Refresh PATH
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker Desktop installed but 'docker' not found in PATH. Please restart your terminal and re-run."
  }
  Ok "Docker Desktop installed"
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 3 — CODE
# ════════════════════════════════════════════════════════════════════════════
Step 3 "Download / update code"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Info "Git not found — installing via winget..."
  winget install --id Git.Git -e --source winget --silent
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

if (Test-Path "$InstallDir\.git") {
  if (AskSkip "Code already at $InstallDir") {
    Ok "Using existing code"
  } else {
    Info "Pulling latest changes..."
    git -C $InstallDir pull origin main
    Ok "Code updated"
  }
} else {
  Info "Cloning repository..."
  git clone $RepoUrl $InstallDir
  Ok "Code cloned to $InstallDir"
}

Set-Location $InstallDir

# ════════════════════════════════════════════════════════════════════════════
# STEP 4 — ENVIRONMENT CONFIG
# ════════════════════════════════════════════════════════════════════════════
Step 4 "Environment configuration"

function Write-Env {
  Write-Host ""
  Write-Host "  Configure your installation:" -ForegroundColor White

  do {
    $Domain = Read-Host "  Domain (e.g. crm.company.com)"
  } while ($Domain -eq "")

  do {
    $AdminEmail = Read-Host "  Admin email"
  } while ($AdminEmail -eq "")

  do {
    $AdminPassword = Read-Host "  Admin password (min 8 chars)" -AsSecureString
    $Plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword))
  } while ($Plain.Length -lt 8)

  $DbPassword     = RandHex 16
  $MinioSecret    = RandHex 16
  $JwtSecret      = RandHex 32
  $RefreshSecret  = RandHex 32
  $EncKey         = RandHex 32
  $GrafanaPass    = RandHex 12
  $Timestamp      = (Get-Date -Format "yyyy-MM-dd HH:mm UTC")

  @"
# ── OpenAgent CRM — Environment ──────────────────────────────────────────────
# Generated by installer on $Timestamp
# DO NOT add AI/payment keys here — configure those from the dashboard.

# ── App ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
DOMAIN=$Domain
ADMIN_EMAIL=$AdminEmail
ADMIN_PASSWORD=$Plain

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://crm:${DbPassword}@pgbouncer:5432/wacrm
DIRECT_DATABASE_URL=postgresql://crm:${DbPassword}@postgres:5432/wacrm
DB_USER=crm
DB_PASSWORD=$DbPassword
DB_NAME=wacrm

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── JWT ──────────────────────────────────────────────────────────────────────
JWT_SECRET=$JwtSecret
REFRESH_TOKEN_SECRET=$RefreshSecret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── Encryption ────────────────────────────────────────────────────────────────
ENCRYPTION_KEY=$EncKey

# ── MinIO ────────────────────────────────────────────────────────────────────
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=$MinioSecret
MINIO_BUCKET=wacrm-media
MINIO_PUBLIC_URL=https://${Domain}/media

# ── Observability ────────────────────────────────────────────────────────────
GRAFANA_PASSWORD=$GrafanaPass
LOG_LEVEL=info

# ── Traefik ──────────────────────────────────────────────────────────────────
ACME_EMAIL=$AdminEmail

# ── Ports ────────────────────────────────────────────────────────────────────
API_PORT=3000
DASHBOARD_PORT=3001
"@ | Out-File -FilePath "$InstallDir\.env" -Encoding utf8 -Force

  Ok ".env written to $InstallDir\.env"
  Info "Grafana password: $GrafanaPass (save this!)"
}

if (Test-Path "$InstallDir\.env") {
  if (-not (AskSkip ".env already configured")) {
    Write-Env
  } else {
    Ok "Using existing .env"
  }
} else {
  Write-Env
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 5 — IMAGES
# ════════════════════════════════════════════════════════════════════════════
Step 5 "Docker images"

$ImagesExist = (docker images --format "{{.Repository}}" 2>$null | Select-String "openagentcrm").Count

if ($ImagesExist -gt 0) {
  if (AskSkip "Images already built ($ImagesExist found)") {
    Ok "Using cached images"
  } else {
    Info "Rebuilding images..."
    docker compose -f $ComposeFile --env-file "$InstallDir\.env" build --quiet
    Ok "Images rebuilt"
  }
} else {
  Info "Pulling/building images..."
  docker compose -f $ComposeFile --env-file "$InstallDir\.env" pull 2>$null
  docker compose -f $ComposeFile --env-file "$InstallDir\.env" build --quiet
  Ok "Images ready"
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 6 — INFRASTRUCTURE
# ════════════════════════════════════════════════════════════════════════════
Step 6 "Infrastructure services"

$InfraRunning = (docker compose -f $ComposeFile ps -q postgres redis minio pgbouncer 2>$null | Measure-Object -Line).Lines

if ($InfraRunning -ge 4) {
  if (AskSkip "Infrastructure already running ($InfraRunning containers)") {
    Ok "Using running infrastructure"
  } else {
    docker compose -f $ComposeFile --env-file "$InstallDir\.env" up -d postgres redis minio pgbouncer
  }
} else {
  Info "Starting infrastructure..."
  docker compose -f $ComposeFile --env-file "$InstallDir\.env" up -d postgres redis minio pgbouncer

  Info "Waiting for services to be healthy..."
  Start-Sleep 10
  Ok "Infrastructure started (check 'docker compose ps' if issues occur)"
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 7 — MIGRATIONS & SEED
# ════════════════════════════════════════════════════════════════════════════
Step 7 "Database migrations & seed"

Info "Running migrations..."
docker compose -f $ComposeFile --env-file "$InstallDir\.env" run --rm api sh -c `
  "npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma"
Ok "Migrations applied"

$UserCount = docker compose -f $ComposeFile --env-file "$InstallDir\.env" run --rm api sh -c `
  "node -e `"const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);p.`$disconnect()})`"" 2>$null | Select-Object -Last 1

if ([int]$UserCount -gt 0) {
  if (AskSkip "Admin user already seeded") {
    Ok "Skipping seed"
  } else {
    docker compose -f $ComposeFile --env-file "$InstallDir\.env" run --rm api sh -c "npx tsx packages/database/prisma/seed.ts"
    Ok "Re-seeded"
  }
} else {
  Info "Seeding database..."
  docker compose -f $ComposeFile --env-file "$InstallDir\.env" run --rm api sh -c "npx tsx packages/database/prisma/seed.ts"
  Ok "Database seeded"
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 8 — START APP
# ════════════════════════════════════════════════════════════════════════════
Step 8 "Start application"

Info "Starting all services..."
docker compose -f $ComposeFile --env-file "$InstallDir\.env" up -d

Info "Waiting for API health check..."
$ApiReady = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $resp = Invoke-WebRequest "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3
    if ($resp.StatusCode -eq 200) { $ApiReady = $true; break }
  } catch {}
  Start-Sleep 3
}
if ($ApiReady) { Ok "API is healthy" } else { Warn "API health check timed out — check: docker compose logs api" }

# Read domain from .env
$DomainVal = (Get-Content "$InstallDir\.env" | Select-String "^DOMAIN=" | ForEach-Object { $_ -replace "DOMAIN=", "" } | Select-Object -First 1)
if (-not $DomainVal) { $DomainVal = "localhost" }

# ════════════════════════════════════════════════════════════════════════════
# DONE
# ════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   OK  OpenAgent CRM is ready!                       ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:   https://$DomainVal" -ForegroundColor Cyan
Write-Host "  API Docs:    https://$DomainVal/api/docs" -ForegroundColor Cyan
Write-Host "  Grafana:     https://$DomainVal/grafana" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next step: Open the dashboard and complete the 6-step setup wizard" -ForegroundColor Yellow
Write-Host "  (configure WhatsApp, AI provider, and payment gateway from the UI)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor White
Write-Host "  docker compose -f $ComposeFile logs -f api" -ForegroundColor Cyan
Write-Host "  docker compose -f $ComposeFile ps" -ForegroundColor Cyan
Write-Host "  docker compose -f $ComposeFile restart" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Reinstall / update anytime:" -ForegroundColor White
Write-Host "  powershell -c `"irm https://openagentcrm.sapheron.com/install.ps1 | iex`"" -ForegroundColor Cyan
Write-Host ""
