# Worktrail 一鍵安裝（Windows）
# 由專案資料夾的「一鍵安裝.cmd」呼叫。會依序：
#   1. 檢查 Node.js 20 以上（沒有時以 winget 安裝）
#   2. 檢查 Claude Code CLI（沒有時以 npm 安裝）與登入狀態（未登入時直接開啟登入）
#   3. 安裝相依套件並建置
#   4. 執行 worktrail install --yes（日誌資料夾沿用上次位置或預設 ~/Worktrail、開機自動啟動；
#      註冊 hook、MCP、指令、CLAUDE.md 規則、捷徑；服務還在跑舊版時自動重啟）
#   5. 開啟 UI
# 只有會改動系統的步驟（安裝 Node.js、Claude Code）會詢問。可重複執行：已安裝的部分會略過或更新成最新版本。

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

function Step($n, $text) { Write-Host ''; Write-Host "[$n/5] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  ✓ $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ⚠ $text" -ForegroundColor Yellow }
function Ask($question, $default = 'Y') {
  $hint = if ($default -eq 'Y') { '[Y/n]' } else { '[y/N]' }
  $a = Read-Host "  $question $hint"
  if ([string]::IsNullOrWhiteSpace($a)) { $a = $default }
  return $a -match '^[Yy]'
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# 執行外部程式並取得輸出，忽略錯誤輸出與失敗。
# Windows PowerShell 5.1 在 $ErrorActionPreference = 'Stop' 時，外部程式寫入 stderr 會被當成例外，所以這裡暫時改回 Continue。
function Invoke-Quiet([string]$exe, [string[]]$arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return ((& $exe @arguments 2>$null) | Out-String).Trim() } catch { return '' } finally { $ErrorActionPreference = $prev }
}
# 已登入回傳 $true、未登入 $false、無法判斷（舊版 Claude Code 沒有 auth status）回傳 $null
function Test-ClaudeLogin {
  $out = Invoke-Quiet claude @('auth', 'status', '--json')
  if ($out -match '"loggedIn"\s*:\s*true') { return $true }
  if ($out -match '"loggedIn"\s*:\s*false') { return $false }
  return $null
}
function Ensure-ClaudeLogin {
  $state = Test-ClaudeLogin
  if ($state -eq $true) { Ok '已登入 Claude 帳號'; return }
  if ($state -eq $null) { return }
  Warn '尚未登入 Claude 帳號（UI 的一鍵產生報告、補寫摘要需要登入）。正在開啟登入，請在瀏覽器完成後回到此視窗。'
  & claude auth login
  if ((Test-ClaudeLogin) -eq $true) { Ok '已登入 Claude 帳號' } else { Warn '尚未完成登入。之後可在終端機執行 claude auth login。' }
}
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') 失敗（結束碼 $LASTEXITCODE）" }
}

Write-Host '══════════════════════════════════════════' -ForegroundColor DarkCyan
Write-Host '  Worktrail：一鍵安裝' -ForegroundColor White
Write-Host "  專案資料夾：$Root"
Write-Host '══════════════════════════════════════════' -ForegroundColor DarkCyan

try {
  # 1. Node.js
  Step 1 '檢查 Node.js（需要 20 以上）'
  $node = Get-Command node -ErrorAction SilentlyContinue
  $major = 0
  if ($node) {
    # 不在參數裡放引號：Windows PowerShell 5.1 傳給外部程式時會吃掉內層的雙引號
    $v = Invoke-Quiet node @('-p', 'process.versions.node')
    if ($v -match '^(\d+)\.') { $major = [int]$Matches[1] }
  }
  if ($major -ge 20) {
    Ok "Node.js $(& node --version)"
  } else {
    if ($node) { Warn "目前的 Node.js 版本太舊（$(& node --version)）" } else { Warn '找不到 Node.js' }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw '找不到 winget。請到 https://nodejs.org 下載安裝 Node.js LTS 後，再執行一次一鍵安裝。'
    }
    if (-not (Ask '要以 winget 安裝 Node.js LTS 嗎？')) { throw '已取消：Worktrail 需要 Node.js 20 以上。' }
    Run winget @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-package-agreements', '--accept-source-agreements')
    Refresh-Path
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 已安裝，但目前視窗找不到。請關閉此視窗後重新執行一鍵安裝。' }
    Ok "已安裝 Node.js $(& node --version)"
  }

  # 2. Claude Code CLI
  Step 2 '檢查 Claude Code CLI'
  if (Get-Command claude -ErrorAction SilentlyContinue) {
    Ok "Claude Code $(Invoke-Quiet claude @('--version'))"
    Ensure-ClaudeLogin
  } else {
    Warn '找不到 claude 指令（UI 一鍵產生報告、補寫摘要、註冊 MCP 都需要它）'
    if (Ask '要以 npm 安裝 Claude Code CLI 嗎？') {
      Run npm @('install', '-g', '@anthropic-ai/claude-code')
      Refresh-Path
      if (Get-Command claude -ErrorAction SilentlyContinue) {
        Ok "已安裝 Claude Code $(Invoke-Quiet claude @('--version'))"
        Ensure-ClaudeLogin
      } else {
        Warn '已安裝，但目前視窗找不到 claude。安裝完成後請開新視窗執行 claude 登入。'
      }
    } else {
      Warn '略過。Worktrail 仍可記錄工作，但 UI 的一鍵產生功能無法使用，MCP 會改為直接寫入設定檔。'
    }
  }

  # 3. 相依套件與建置
  Step 3 '安裝相依套件並建置（第一次約需 1～3 分鐘）'
  Run npm @('install', '--no-fund', '--no-audit', '--loglevel=error')
  Ok '相依套件'
  Run npm @('run', 'build', '--silent')
  Ok '建置 CLI、hook、UI'
  Run npm @('run', 'build:launcher', '--silent')
  Ok '建置一鍵啟動器（worktrail-launcher.exe）'

  # 4. 安裝
  Step 4 '安裝 Worktrail'
  Run node @('dist\cli.cjs', 'install', '--yes')
  Ok '日誌資料夾與開機自動啟動可在 Worktrail 的「設定」頁更改'

  # 5. 開啟
  Step 5 '開啟 Worktrail'
  Start-Process -FilePath (Join-Path $Root 'dist\worktrail-launcher.exe')
  Ok '已開啟。之後可點桌面或專案資料夾內的「啟動 Worktrail」捷徑。'

  Write-Host ''
  Write-Host '安裝完成！請開啟新的 Claude Code 對話，自動記錄才會生效。' -ForegroundColor Green
  Write-Host '說明手冊：docs\安裝與解除說明.md'
} catch {
  Write-Host ''
  Write-Host "✗ 安裝失敗：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  可執行 node dist\cli.cjs doctor 檢查狀態，或參考 docs\安裝與解除說明.md 的「疑難排解」。'
  Write-Host ''
  Read-Host '按 Enter 關閉'
  exit 1
}
Write-Host ''
Read-Host '按 Enter 關閉'
