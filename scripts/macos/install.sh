#!/bin/sh
# Worktrail 一鍵安裝（macOS）。由專案資料夾的「一鍵安裝.command」呼叫。
set -e
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
section() { echo ""; echo "$1"; }
ask() { printf "  %s [Y/n] " "$1"; read -r a; [ -z "$a" ] || [ "$a" = "y" ] || [ "$a" = "Y" ]; }
fail() { printf "\n✗ 安裝失敗：%s\n" "$1"; printf "按 Enter 關閉"; read -r _; exit 1; }
# 已登入 0、未登入 1、無法判斷（舊版 Claude Code 沒有 auth status）2
login_state() {
  out=$(claude auth status --json 2>/dev/null) || return 2
  echo "$out" | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*true' && return 0
  echo "$out" | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*false' && return 1
  return 2
}
ensure_login() {
  st=0; login_state || st=$?
  if [ $st -eq 0 ]; then echo "  ✓ 已登入 Claude 帳號"; return; fi
  [ $st -eq 2 ] && return
  echo "  ⚠ 尚未登入 Claude 帳號（UI 的一鍵產生報告、補寫摘要需要登入）。正在開啟登入，請在瀏覽器完成後回到此視窗。"
  claude auth login || true
  if login_state; then echo "  ✓ 已登入 Claude 帳號"; else echo "  ⚠ 尚未完成登入。之後可在終端機執行 claude auth login。"; fi
}

echo "══════ Worktrail：一鍵安裝 ══════"
echo "專案資料夾：$ROOT"

section "[1/5] 檢查 Node.js（需要 20 以上）"
MAJOR=0
command -v node >/dev/null 2>&1 && MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -ge 20 ]; then echo "  ✓ Node.js $(node --version)"; else
  command -v brew >/dev/null 2>&1 || fail "找不到 Node.js 20 以上，也沒有 Homebrew。請到 https://nodejs.org 安裝 Node.js LTS 後再執行。"
  ask "要以 Homebrew 安裝 Node.js 嗎？" || fail "Worktrail 需要 Node.js 20 以上"
  brew install node || fail "Node.js 安裝失敗"
fi

section "[2/5] 檢查 Claude Code CLI"
if command -v claude >/dev/null 2>&1; then echo "  ✓ Claude Code $(claude --version)"; ensure_login; else
  if ask "找不到 claude，要以 npm 安裝 Claude Code CLI 嗎？"; then
    npm install -g @anthropic-ai/claude-code || fail "Claude Code 安裝失敗"
    ensure_login
  else echo "  ⚠ 略過：UI 的一鍵產生功能將無法使用。"; fi
fi

section "[3/5] 安裝相依套件並建置"
npm install --no-fund --no-audit --loglevel=error || fail "npm install 失敗"
npm run build --silent || fail "建置失敗"

section "[4/5] 安裝 Worktrail"
node dist/cli.cjs install --yes || fail "worktrail install 失敗"
echo "  ✓ 日誌資料夾與開機自動啟動可在 Worktrail 的「設定」頁更改"

section "[5/5] 開啟 Worktrail"
node dist/cli.cjs open

section "安裝完成！請開啟新的 Claude Code 對話，自動記錄才會生效。"
printf "按 Enter 關閉"; read -r _
