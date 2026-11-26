/**
 * 規格 13：install／uninstall。冪等、不破壞既有設定、可還原。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { findClaude } from '../core/claude-cli/index.js';
import { cliEntry, distDir, hookEntry } from '../core/program.js';
import { loadConfig } from '../core/storage/config-store.js';
import { ensureDir, readText, writeFileAtomic } from '../core/storage/fsutil.js';
import { initStorage } from '../core/storage/init.js';
import { defaultStorageRoot, pointerPath, readPointer, StoragePaths, worktrailHome } from '../core/storage/paths.js';
import { restartIfOutdated, stopDaemon } from '../daemon/client.js';
import {
  backupFile,
  claudeMdPath,
  installCommands,
  readSettings,
  registerMcp,
  removeCommands,
  settingsPath,
  unregisterMcp,
  writeSettings,
} from './claude-config.js';
import { addClaudeMdBlock, addWorktrailSettings, removeClaudeMdBlock, removeWorktrailSettings } from './merge.js';
import { createShortcuts, removeShortcuts, setAutostart } from './shortcuts.js';

export interface InstallOptions {
  storage?: string;
  /** 不詢問，全部採預設或參數值 */
  yes?: boolean;
  shortcuts?: boolean;
  autostart?: boolean;
  /** 測試用：不呼叫 claude CLI 註冊 MCP，直接寫 .claude.json */
  mcpViaFile?: boolean;
  log?: (msg: string) => void;
}

async function ask(question: string, fallback: string, yes?: boolean): Promise<string> {
  if (yes || !process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${question}（預設：${fallback}）：`)).trim();
    return a || fallback;
  } finally {
    rl.close();
  }
}

async function confirm(question: string, fallback: boolean, yes?: boolean): Promise<boolean> {
  const a = await ask(`${question} [${fallback ? 'Y/n' : 'y/N'}]`, fallback ? 'y' : 'n', yes);
  return /^y/i.test(a);
}

export async function install(opts: InstallOptions = {}): Promise<void> {
  const log = opts.log ?? console.log;
  const nodePath = process.execPath;

  // 1. 環境檢查
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`需要 Node.js 20 以上，目前為 ${process.versions.node}`);
  if (!existsSync(hookEntry()) || !existsSync(cliEntry())) {
    throw new Error(`找不到建置後的程式（${hookEntry()}），請先執行 npm run build`);
  }
  const claudePath = opts.mcpViaFile ? null : await findClaude('');
  log(claudePath ? `✓ 找到 claude CLI：${claudePath}` : '⚠ 找不到 claude CLI：MCP 改為直接寫入設定檔，UI 一鍵產生功能需要 claude CLI');

  // 2. 儲存資料夾
  const current = readPointer()?.storage_root;
  const root = resolve(opts.storage ?? (await ask('工作日誌要存放在哪個資料夾', current ?? defaultStorageRoot(), opts.yes)));
  ensureDir(worktrailHome());
  writeFileAtomic(pointerPath(), `${JSON.stringify({ storage_root: root }, null, 2)}\n`);
  log(`✓ 儲存資料夾：${root}`);

  // 3. 資料夾結構、預設設定與範本
  const paths = new StoragePaths(root);
  const created = initStorage(paths);
  if (created.length) log(`✓ 建立 ${created.length} 個資料夾／檔案`);

  // 4. MCP
  const how = await registerMcp(claudePath, nodePath, cliEntry());
  log(`✓ 註冊 MCP Server（${how === 'cli' ? 'claude mcp add' : '寫入 .claude.json'}）`);

  // 5. hooks 與權限（已是最新時不備份、不寫入）
  const currentSettings = readSettings();
  const merged = addWorktrailSettings(currentSettings, nodePath, hookEntry());
  if (stableJson(merged) !== stableJson(currentSettings)) {
    const backup = backupFile(settingsPath());
    writeSettings(merged);
    log(`✓ 合併 hooks 與權限到 settings.json${backup ? `（備份：${backup}）` : ''}`);
  } else {
    log('✓ settings.json 的 hooks 與權限已是最新');
  }

  // 6. slash commands
  log(`✓ 安裝 ${installCommands().length} 個指令（/worklog、/worklog-weekly、/worklog-perf、/worklog-ui）`);

  // 7. CLAUDE.md
  const md = readText(claudeMdPath()) ?? '';
  const nextMd = addClaudeMdBlock(md);
  if (nextMd !== md) {
    if (md) backupFile(claudeMdPath());
    writeFileAtomic(claudeMdPath(), nextMd);
    log('✓ 在 CLAUDE.md 加入工作日誌規則');
  } else {
    log('✓ CLAUDE.md 的工作日誌規則已是最新');
  }

  // 8. 捷徑與開機啟動（啟動器以此檔找到 node）
  writeFileAtomic(join(distDir(), 'node-path.txt'), nodePath);
  if (opts.shortcuts !== false) {
    try {
      const made = await createShortcuts(nodePath);
      if (made.length) log(`✓ 建立捷徑：${made.join('、')}`);
      const auto = opts.autostart ?? (await confirm('開機時自動啟動 Worktrail 服務？', true, opts.yes));
      await setAutostart(nodePath, auto);
      log(auto ? '✓ 已設定開機自動啟動' : '· 未設定開機自動啟動');
    } catch (e) {
      log(`⚠ ${(e as Error).message}`);
    }
  }

  // 9. 更新後服務還在跑舊程式：自動重啟
  if (await restartIfOutdated(nodePath).catch(() => false)) log('✓ 已重新啟動服務，套用新版程式');

  // 10. 檢查
  const { config, error } = loadConfig(paths);
  if (error) log(`⚠ config.yaml 有誤（第 ${error.line ?? '?'} 行）：${error.message}`);
  log(`\n安裝完成。UI：http://localhost:${config.ui.port}`);
  log('請開啟新的 Claude Code 對話，設定才會生效。');
}

export interface UninstallOptions {
  purge?: boolean;
  yes?: boolean;
  mcpViaFile?: boolean;
  shortcuts?: boolean;
  log?: (msg: string) => void;
}

export async function uninstall(opts: UninstallOptions = {}): Promise<void> {
  const log = opts.log ?? console.log;
  await stopDaemon().catch(() => false);
  log('✓ 停止常駐服務');

  const claudePath = opts.mcpViaFile ? null : await findClaude('');
  await unregisterMcp(claudePath);
  log('✓ 移除 MCP Server 註冊');

  if (existsSync(settingsPath())) {
    backupFile(settingsPath());
    writeSettings(removeWorktrailSettings(readSettings(), hookEntry()));
    log('✓ 從 settings.json 移除 hooks 與權限');
  }
  log(`✓ 移除 ${removeCommands().length} 個指令檔`);

  const md = readText(claudeMdPath());
  if (md !== null) {
    writeFileAtomic(claudeMdPath(), removeClaudeMdBlock(md));
    log('✓ 從 CLAUDE.md 移除工作日誌規則');
  }

  if (opts.shortcuts !== false) {
    await removeShortcuts().catch(() => undefined);
    log('✓ 移除捷徑與開機啟動');
  }

  const root = readPointer()?.storage_root;
  if (opts.purge && root) {
    const sure = await confirm(`確定要刪除整個資料夾 ${root}（所有日誌、週報、績效）？此動作無法復原`, false, opts.yes);
    if (sure) {
      rmSync(root, { recursive: true, force: true });
      log(`✓ 已刪除 ${root}`);
    } else {
      log('· 保留資料夾');
    }
  } else if (root) {
    log(`· 日誌資料保留在 ${root}`);
  }
  rmSync(pointerPath(), { force: true });
  log('\n移除完成。');
}

export function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 不受物件鍵順序影響的 JSON（Claude Code 會以不同順序改寫 settings.json，內容相同時不應再備份、寫入） */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
