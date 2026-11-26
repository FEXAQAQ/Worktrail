# Worktrail 一鍵解除安裝（Windows）
# 由專案資料夾的「一鍵解除安裝.cmd」呼叫。
# 移除：hook、MCP 註冊、/worklog 指令、CLAUDE.md 規則區塊、捷徑、開機啟動，並停止服務。
# 保留：所有日誌、週報、績效、範本與設定（儲存資料夾不會被刪除）；Node.js 與 Claude Code 也不會被移除。

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

Write-Host '══════════════════════════════════════════' -ForegroundColor DarkCyan
Write-Host '  Worktrail：一鍵解除安裝' -ForegroundColor White
Write-Host '══════════════════════════════════════════' -ForegroundColor DarkCyan

$pointer = Join-Path $env:USERPROFILE '.worktrail\pointer.json'
$storage = $null
if (Test-Path $pointer) { $storage = (Get-Content $pointer -Raw -Encoding UTF8 | ConvertFrom-Json).storage_root }

Write-Host ''
Write-Host '將會移除：' -ForegroundColor White
Write-Host '  • Claude Code 的 hook、MCP Server 註冊、/worklog 系列指令'
Write-Host '  • ~/.claude/CLAUDE.md 中的工作日誌規則（只刪除 Worktrail 的區塊）'
Write-Host '  • 桌面、開始功能表、專案資料夾的捷徑與開機自動啟動'
Write-Host ''
Write-Host '會保留：' -ForegroundColor White
if ($storage) { Write-Host "  • 所有日誌、週報、績效與設定：$storage" -ForegroundColor Green }
else { Write-Host '  • 所有日誌、週報、績效與設定（儲存資料夾）' -ForegroundColor Green }
Write-Host '  • Node.js、Claude Code 與這個專案資料夾'
Write-Host ''

$a = Read-Host '確定要解除安裝嗎？[y/N]'
if ($a -notmatch '^[Yy]') {
  Write-Host '已取消。'
  Read-Host '按 Enter 關閉'
  exit 0
}

try {
  if (-not (Test-Path (Join-Path $Root 'dist\cli.cjs'))) {
    Write-Host '找不到建置後的程式，先重新建置…'
    & npm install --no-fund --no-audit --loglevel=error
    & npm run build:core --silent
  }
  & node 'dist\cli.cjs' uninstall --yes
  if ($LASTEXITCODE -ne 0) { throw "worktrail uninstall 失敗（結束碼 $LASTEXITCODE）" }
  Write-Host ''
  Write-Host '解除安裝完成。請開啟新的 Claude Code 對話，設定變更才會生效。' -ForegroundColor Green
  if ($storage) { Write-Host "日誌資料仍在 $storage；之後重新執行一鍵安裝並選同一個資料夾，就能接續使用。" }
} catch {
  Write-Host "✗ 解除安裝失敗：$($_.Exception.Message)" -ForegroundColor Red
  Read-Host '按 Enter 關閉'
  exit 1
}
Write-Host ''
Read-Host '按 Enter 關閉'
