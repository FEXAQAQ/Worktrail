/**
 * 讀寫使用者的 Claude Code 設定檔：settings.json、CLAUDE.md、commands/、MCP 註冊。
 */
import { exec, execFile } from 'node:child_process';
import { shellCommand } from '../core/claude-cli/index.js';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureDir, readText, writeFileAtomic } from '../core/storage/fsutil.js';
import { claudeHome } from '../core/storage/paths.js';
import { COMMAND_MARKER, SLASH_COMMANDS } from '../templates/claude.js';
import type { ClaudeSettings } from './merge.js';

export const settingsPath = () => join(claudeHome(), 'settings.json');
export const claudeMdPath = () => join(claudeHome(), 'CLAUDE.md');
export const commandsDir = () => join(claudeHome(), 'commands');
/** user scope 的 MCP 設定檔；設定 CLAUDE_CONFIG_DIR 時位於該資料夾內 */
export const claudeJsonPath = () =>
  process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');

export function readSettings(): ClaudeSettings {
  const text = readText(settingsPath());
  if (!text?.trim()) return {};
  return JSON.parse(text) as ClaudeSettings;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/** 修改前先備份（規格 13.2 第 5 步） */
export function backupFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const dest = `${path}.worktrail-backup-${stamp()}`;
  copyFileSync(path, dest);
  return dest;
}

export function writeSettings(s: ClaudeSettings): void {
  writeFileAtomic(settingsPath(), `${JSON.stringify(s, null, 2)}\n`);
}

export function installCommands(): string[] {
  ensureDir(commandsDir());
  const written: string[] = [];
  for (const [name, text] of Object.entries(SLASH_COMMANDS)) {
    const p = join(commandsDir(), name);
    const existing = readText(p);
    // 不覆寫使用者自己同名的指令檔
    if (existing !== null && !existing.includes(COMMAND_MARKER)) continue;
    writeFileAtomic(p, text);
    written.push(p);
  }
  return written;
}

export function removeCommands(): string[] {
  if (!existsSync(commandsDir())) return [];
  const removed: string[] = [];
  for (const f of readdirSync(commandsDir())) {
    const p = join(commandsDir(), f);
    if (f.startsWith('worklog') && f.endsWith('.md') && readText(p)?.includes(COMMAND_MARKER)) {
      rmSync(p, { force: true });
      removed.push(p);
    }
  }
  return removed;
}

export function installedCommands(): string[] {
  return Object.keys(SLASH_COMMANDS).filter((n) => readText(join(commandsDir(), n))?.includes(COMMAND_MARKER));
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const done =
    (resolve: (r: { ok: boolean; out: string }) => void) => (err: Error | null, stdout: string, stderr: string) =>
      resolve({ ok: !err, out: `${stdout}${stderr}` });
  return new Promise((resolve) => {
    if (/\.(cmd|bat)$/i.test(cmd)) {
      // .cmd 必須經由 cmd.exe 執行；組成完整指令字串（Node 已棄用 shell 模式搭配參數陣列）
      exec(shellCommand(cmd, args), { windowsHide: true, timeout: 30_000 }, done(resolve));
    } else {
      execFile(cmd, args, { windowsHide: true, timeout: 30_000 }, done(resolve));
    }
  });
}

interface ClaudeJson {
  mcpServers?: Record<string, { type?: string; command?: string; args?: string[]; env?: Record<string, string> }>;
  [k: string]: unknown;
}

function readClaudeJson(): ClaudeJson {
  try {
    return JSON.parse(readFileSync(claudeJsonPath(), 'utf8')) as ClaudeJson;
  } catch {
    return {};
  }
}

/**
 * 規格 13.2 第 4 步：以 `claude mcp add --scope user` 註冊。
 * claude CLI 不可用時，直接寫入 user scope 的 .claude.json（同樣的格式）。
 */
export async function registerMcp(claudePath: string | null, nodePath: string, cliPath: string): Promise<'cli' | 'file'> {
  if (claudePath) {
    await run(claudePath, ['mcp', 'remove', '--scope', 'user', 'worktrail']);
    const r = await run(claudePath, ['mcp', 'add', '--scope', 'user', 'worktrail', '--', nodePath, cliPath, 'mcp']);
    if (r.ok) return 'cli';
  }
  const j = readClaudeJson();
  j.mcpServers ??= {};
  j.mcpServers.worktrail = { type: 'stdio', command: nodePath, args: [cliPath, 'mcp'], env: {} };
  if (existsSync(claudeJsonPath())) backupFile(claudeJsonPath());
  writeFileAtomic(claudeJsonPath(), `${JSON.stringify(j, null, 2)}\n`);
  return 'file';
}

export async function unregisterMcp(claudePath: string | null): Promise<void> {
  if (claudePath) await run(claudePath, ['mcp', 'remove', '--scope', 'user', 'worktrail']);
  const j = readClaudeJson();
  if (j.mcpServers?.worktrail) {
    delete j.mcpServers.worktrail;
    writeFileAtomic(claudeJsonPath(), `${JSON.stringify(j, null, 2)}\n`);
  }
}

export function mcpRegistration(): { command?: string; args?: string[] } | null {
  return readClaudeJson().mcpServers?.worktrail ?? null;
}
