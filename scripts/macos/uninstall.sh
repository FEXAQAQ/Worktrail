#!/bin/sh
# Worktrail 一鍵解除安裝（macOS）：移除設定與捷徑，保留所有日誌資料。
cd "$(dirname "$0")/../.."
echo "══════ Worktrail：一鍵解除安裝 ══════"
echo "將移除：hook、MCP 註冊、/worklog 指令、CLAUDE.md 規則、Worktrail.app 與開機啟動"
echo "會保留：所有日誌、週報、績效與設定（儲存資料夾），以及 Node.js、Claude Code"
printf "\n確定要解除安裝嗎？[y/N] "; read -r a
case "$a" in y|Y) ;; *) echo "已取消。"; exit 0 ;; esac
[ -f dist/cli.cjs ] || { npm install --no-fund --no-audit --loglevel=error && npm run build:core --silent; }
node dist/cli.cjs uninstall --yes && printf "\n解除安裝完成。請開啟新的 Claude Code 對話，設定變更才會生效。\n"
printf "按 Enter 關閉"; read -r _
