/**
 * `worktrail doctor`：檢查安裝狀態並列出修復建議（規格 13.1、15）。
 * daemon 的 /api/health 也使用同一份檢查結果。
 */
import { existsSync } from 'node:fs';
import { claudeLoginStatus, findClaude } from '../core/claude-cli/index.js';
import { cliEntry, hookEntry } from '../core/program.js';
import { loadConfig } from '../core/storage/config-store.js';
import { readText } from '../core/storage/fsutil.js';
import { recentErrors } from '../core/storage/log.js';
import { readPointer, StoragePaths } from '../core/storage/paths.js';
import { isDaemonRunning, readDaemonInfo } from '../daemon/client.js';
import { claudeMdPath, installedCommands, mcpRegistration, readSettings } from './claude-config.js';
import { countWorktrailHooks, hasClaudeMdBlock, MCP_PERMISSION } from './merge.js';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  fix?: string;
  /** 非必要項目：失敗時只是警告 */
  optional?: boolean;
}

/** checkLogin：是否執行 `claude auth status` 檢查登入（預設是；測試必須關閉，避免啟動真正的 claude） */
export async function runChecks(opts: { includeDaemon?: boolean; checkLogin?: boolean } = {}): Promise<{ checks: Check[]; errors: string[] }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const major = Number(process.versions.node.split('.')[0]);
  add({ id: 'node', label: 'Node.js 20 以上', ok: major >= 20, detail: process.versions.node });

  add({
    id: 'build',
    label: '程式已建置',
    ok: existsSync(hookEntry()) && existsSync(cliEntry()),
    detail: hookEntry(),
    fix: '在專案資料夾執行 npm run build',
  });

  const pointer = readPointer();
  const root = pointer?.storage_root;
  add({ id: 'pointer', label: '儲存資料夾已設定', ok: !!root, detail: root, fix: '執行 worktrail install' });

  let errors: string[] = [];
  if (root) {
    const paths = new StoragePaths(root);
    add({ id: 'storage', label: '儲存資料夾存在', ok: paths.exists(), detail: root, fix: '執行 worktrail install 重新建立' });
    const { config, error } = loadConfig(paths);
    add({
      id: 'config',
      label: 'config.yaml 格式正確',
      ok: !error,
      detail: error ? `第 ${error.line ?? '?'} 行：${error.message}` : undefined,
      fix: '在 UI 設定頁修正，或直接編輯 config.yaml',
    });
    const claude = await findClaude(config.claude_cli.path);
    add({
      id: 'claude-cli',
      label: 'claude CLI 可執行',
      ok: !!claude,
      detail: claude ?? undefined,
      fix: '安裝 Claude Code CLI，或在設定中指定路徑（UI 一鍵產生與補寫摘要需要）',
      optional: true,
    });
    if (claude && opts.checkLogin !== false) {
      const loggedIn = await claudeLoginStatus(claude);
      if (loggedIn !== null) {
        add({
          id: 'claude-login',
          label: '已登入 Claude 帳號',
          ok: loggedIn,
          fix: '在終端機執行 claude auth login 完成登入（UI 一鍵產生與補寫摘要需要）',
          optional: true,
        });
      }
    }
    errors = recentErrors(paths);
  }

  let settingsOk = true;
  let counts: Record<string, number> = {};
  let permission = false;
  try {
    const s = readSettings();
    counts = countWorktrailHooks(s, hookEntry());
    permission = !!s.permissions?.allow?.includes(MCP_PERMISSION);
  } catch (e) {
    settingsOk = false;
    add({ id: 'settings', label: 'settings.json 可讀取', ok: false, detail: (e as Error).message });
  }
  if (settingsOk) {
    const missing = Object.entries(counts).filter(([, n]) => n !== 1);
    add({
      id: 'hooks',
      label: 'SessionStart／Stop／SessionEnd hook 已註冊',
      ok: missing.length === 0,
      detail: missing.length ? missing.map(([e, n]) => `${e}: ${n} 個`).join('、') : undefined,
      fix: '執行 worktrail install',
    });
    add({ id: 'permission', label: `權限 ${MCP_PERMISSION}`, ok: permission, fix: '執行 worktrail install' });
  }

  const mcp = mcpRegistration();
  add({
    id: 'mcp',
    label: 'MCP Server 已註冊',
    ok: !!mcp,
    detail: mcp ? [mcp.command, ...(mcp.args ?? [])].join(' ') : undefined,
    fix: '執行 worktrail install',
  });

  const cmds = installedCommands();
  add({ id: 'commands', label: 'slash commands', ok: cmds.length === 4, detail: cmds.join(', '), fix: '執行 worktrail install' });

  add({
    id: 'claude-md',
    label: 'CLAUDE.md 工作日誌規則',
    ok: hasClaudeMdBlock(readText(claudeMdPath()) ?? ''),
    fix: '執行 worktrail install',
  });

  if (opts.includeDaemon !== false) {
    const info = readDaemonInfo();
    const running = await isDaemonRunning(info);
    add({
      id: 'daemon',
      label: '常駐服務執行中',
      ok: running,
      detail: running && info ? `http://localhost:${info.port}（pid ${info.pid}）` : undefined,
      fix: '執行 worktrail start，或點擊 Worktrail 捷徑',
      optional: true,
    });
  }
  return { checks, errors };
}

export async function doctor(log: (s: string) => void = console.log): Promise<number> {
  const { checks, errors } = await runChecks();
  for (const c of checks) {
    const mark = c.ok ? '✓' : c.optional ? '⚠' : '✗';
    log(`${mark} ${c.label}${c.detail ? `：${c.detail}` : ''}`);
    if (!c.ok && c.fix) log(`    → ${c.fix}`);
  }
  if (errors.length) {
    log('\n最近的錯誤與警告：');
    for (const e of errors) log(`  ${e}`);
  }
  const failed = checks.filter((c) => !c.ok && !c.optional).length;
  log(failed ? `\n${failed} 項需要修復。` : '\n一切正常。');
  return failed ? 1 : 0;
}
