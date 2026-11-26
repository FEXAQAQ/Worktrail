/**
 * 規格 13.3：合併／移除 settings.json 與 CLAUDE.md（純函式）。
 * 只辨識並修改含 Worktrail 標記的項目，保留使用者其他設定。
 */
import { CLAUDE_MD_BLOCK, CLAUDE_MD_END, CLAUDE_MD_START } from '../templates/claude.js';

export const HOOK_EVENTS = {
  SessionStart: 'session-start',
  Stop: 'stop',
  SessionEnd: 'session-end',
} as const;

export const MCP_PERMISSION = 'mcp__worktrail__*';

interface HookCommand {
  type?: string;
  command?: string;
  timeout?: number;
  [k: string]: unknown;
}
interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}
export interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  permissions?: { allow?: string[]; [k: string]: unknown };
  [k: string]: unknown;
}

/** hook 指令是否屬於 Worktrail：含 hook 程式路徑，或含 worktrail 與 hook.cjs（程式搬移後仍可辨識） */
export function isWorktrailCommand(command: string | undefined, hookPath: string): boolean {
  if (!command) return false;
  const c = command.replace(/\\/g, '/').toLowerCase();
  return c.includes(hookPath.replace(/\\/g, '/').toLowerCase()) || (c.includes('worktrail') && c.includes('hook.cjs'));
}

function stripWorktrailHooks(settings: ClaudeSettings, hookPath: string): ClaudeSettings {
  const s: ClaudeSettings = structuredClone(settings);
  if (!s.hooks) return s;
  for (const [event, matchers] of Object.entries(s.hooks)) {
    const kept: HookMatcher[] = [];
    for (const m of matchers ?? []) {
      const hooks = (m.hooks ?? []).filter((h) => !isWorktrailCommand(h.command, hookPath));
      if (hooks.length) kept.push({ ...m, hooks });
      else if (!m.hooks?.length) kept.push(m);
    }
    if (kept.length) s.hooks[event] = kept;
    else delete s.hooks[event];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

export function addWorktrailSettings(settings: ClaudeSettings, nodePath: string, hookPath: string): ClaudeSettings {
  const s = stripWorktrailHooks(settings, hookPath);
  s.hooks ??= {};
  for (const [event, arg] of Object.entries(HOOK_EVENTS)) {
    (s.hooks[event] ??= []).push({
      hooks: [{ type: 'command', command: `"${nodePath}" "${hookPath}" ${arg}`, timeout: 10 }],
    });
  }
  s.permissions ??= {};
  const allow = s.permissions.allow ?? [];
  if (!allow.includes(MCP_PERMISSION)) allow.push(MCP_PERMISSION);
  s.permissions.allow = allow;
  return s;
}

export function removeWorktrailSettings(settings: ClaudeSettings, hookPath: string): ClaudeSettings {
  const s = stripWorktrailHooks(settings, hookPath);
  if (s.permissions?.allow) {
    s.permissions.allow = s.permissions.allow.filter((p) => p !== MCP_PERMISSION);
    if (!s.permissions.allow.length) delete s.permissions.allow;
    if (!Object.keys(s.permissions).length) delete s.permissions;
  }
  return s;
}

export function countWorktrailHooks(settings: ClaudeSettings, hookPath: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of Object.keys(HOOK_EVENTS)) {
    out[event] = (settings.hooks?.[event] ?? [])
      .flatMap((m) => m.hooks ?? [])
      .filter((h) => isWorktrailCommand(h.command, hookPath)).length;
  }
  return out;
}

const BLOCK_RE = new RegExp(`\\n*${escape(CLAUDE_MD_START)}[\\s\\S]*?${escape(CLAUDE_MD_END)}\\n?`, 'g');
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function addClaudeMdBlock(text: string): string {
  const stripped = text.replace(BLOCK_RE, '\n').replace(/\s+$/, '');
  return `${stripped ? `${stripped}\n\n` : ''}${CLAUDE_MD_BLOCK}\n`;
}

export function removeClaudeMdBlock(text: string): string {
  const out = text.replace(BLOCK_RE, '\n').replace(/\s+$/, '');
  return out ? `${out}\n` : '';
}

export function hasClaudeMdBlock(text: string): boolean {
  return text.includes(CLAUDE_MD_START) && text.includes(CLAUDE_MD_END);
}
