// 將 Windows 批次檔與 PowerShell 腳本轉成 CRLF（PowerShell 腳本另加 UTF-8 BOM，Windows PowerShell 5.1 才能正確讀取中文）
import { readFileSync, writeFileSync } from 'node:fs';

for (const f of ['一鍵安裝.cmd', '一鍵解除安裝.cmd', 'scripts/windows/install.ps1', 'scripts/windows/uninstall.ps1']) {
  let text = readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r?\n/g, '\r\n');
  if (f.endsWith('.ps1')) text = `﻿${text}`;
  writeFileSync(f, text, 'utf8');
}
console.log('✓ CRLF／BOM');
