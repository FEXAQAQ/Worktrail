import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hookEntry } from '../src/core/program.js';
import { runChecks } from '../src/installer/doctor.js';
import { install, uninstall } from '../src/installer/install.js';
import { addClaudeMdBlock, addWorktrailSettings, countWorktrailHooks, removeClaudeMdBlock, removeWorktrailSettings } from '../src/installer/merge.js';
import { makeEnv, type TestEnv } from './env.js';

const USER_SETTINGS = {
  model: 'opus',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node C:\\Users\\me\\.pixel-agents\\hooks\\claude-hook.js' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
  },
  permissions: { allow: ['Bash(git status)'] },
};
const USER_MD = '# 我的規則\n\n- 回覆用繁體中文\n';

describe('settings.json／CLAUDE.md 合併（純函式）', () => {
  const hook = 'C:\\Program Files\\worktrail\\dist\\hook.cjs';

  it('加入三個 hook 與權限，保留使用者其他設定；重複執行不重複', () => {
    const once = addWorktrailSettings(USER_SETTINGS, 'C:\\Program Files\\nodejs\\node.exe', hook);
    const twice = addWorktrailSettings(once, 'C:\\Program Files\\nodejs\\node.exe', hook);
    expect(twice).toEqual(once);
    expect(countWorktrailHooks(once, hook)).toEqual({ SessionStart: 1, Stop: 1, SessionEnd: 1 });
    expect(once.hooks!.Stop).toHaveLength(2);
    expect(once.hooks!.PreToolUse).toEqual(USER_SETTINGS.hooks.PreToolUse);
    expect(once.permissions!.allow).toEqual(['Bash(git status)', 'mcp__worktrail__*']);
    // 路徑含空白時加上引號
    expect(once.hooks!.Stop![1]!.hooks![0]!.command).toBe(`"C:\\Program Files\\nodejs\\node.exe" "${hook}" stop`);
  });

  it('移除後與原本完全相同', () => {
    const added = addWorktrailSettings(USER_SETTINGS, 'node', hook);
    expect(removeWorktrailSettings(added, hook)).toEqual(USER_SETTINGS);
    expect(removeWorktrailSettings(addWorktrailSettings({}, 'node', hook), hook)).toEqual({});
  });

  it('程式搬移後仍能辨識舊的 Worktrail hook', () => {
    const old = addWorktrailSettings({}, 'node', 'D:\\old\\worktrail\\dist\\hook.cjs');
    const moved = addWorktrailSettings(old, 'node', hook);
    expect(countWorktrailHooks(moved, hook)).toEqual({ SessionStart: 1, Stop: 1, SessionEnd: 1 });
  });

  it('CLAUDE.md 區塊加入與精準移除', () => {
    const added = addClaudeMdBlock(USER_MD);
    expect(addClaudeMdBlock(added)).toBe(added);
    expect(added).toContain('<!-- worktrail:start -->');
    expect(removeClaudeMdBlock(added)).toBe(USER_MD);
    expect(removeClaudeMdBlock(addClaudeMdBlock(''))).toBe('');
  });
});

describe('install／uninstall（暫存 HOME）', () => {
  let env: TestEnv;
  const quiet = () => undefined;

  beforeAll(() => {
    if (!existsSync(hookEntry())) throw new Error('請先執行 npm run build:core');
    env = makeEnv({ install: false });
    writeFileSync(join(env.claude, 'settings.json'), JSON.stringify(USER_SETTINGS, null, 2));
    writeFileSync(join(env.claude, 'CLAUDE.md'), USER_MD);
  });
  afterAll(() => env.cleanup());

  it('安裝完成所有設定，且冪等', async () => {
    await install({ storage: env.storage, yes: true, shortcuts: false, mcpViaFile: true, log: quiet });
    await install({ storage: env.storage, yes: true, shortcuts: false, mcpViaFile: true, log: quiet });

    const settings = JSON.parse(readFileSync(join(env.claude, 'settings.json'), 'utf8'));
    expect(countWorktrailHooks(settings, hookEntry())).toEqual({ SessionStart: 1, Stop: 1, SessionEnd: 1 });
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.model).toBe('opus');

    const claudeJson = JSON.parse(readFileSync(join(env.claude, '.claude.json'), 'utf8'));
    expect(claudeJson.mcpServers.worktrail.args.at(-1)).toBe('mcp');

    for (const f of ['worklog.md', 'worklog-weekly.md', 'worklog-perf.md', 'worklog-ui.md']) {
      expect(existsSync(join(env.claude, 'commands', f))).toBe(true);
    }
    const md = readFileSync(join(env.claude, 'CLAUDE.md'), 'utf8');
    expect(md.startsWith(USER_MD.trim())).toBe(true);
    expect(md.match(/worktrail:start/g)).toHaveLength(1);

    expect(existsSync(join(env.storage, 'config.yaml'))).toBe(true);
    expect(existsSync(join(env.storage, 'prompts', 'weekly', 'default.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(env.home, 'pointer.json'), 'utf8')).storage_root).toBe(env.storage);
  });

  it('settings.json 只是鍵的順序不同時，不再備份或改寫', async () => {
    const path = join(env.claude, 'settings.json');
    const s = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    // 模擬 Claude Code 以不同順序改寫設定
    writeFileSync(path, JSON.stringify(Object.fromEntries(Object.entries(s).reverse()), null, 2));
    const before = readdirSync(env.claude).filter((f) => f.startsWith('settings.json.worktrail-backup-')).length;
    const logs: string[] = [];
    await install({ storage: env.storage, yes: true, shortcuts: false, mcpViaFile: true, log: (m) => logs.push(m) });
    expect(readdirSync(env.claude).filter((f) => f.startsWith('settings.json.worktrail-backup-')).length).toBe(before);
    expect(logs.join('\n')).toContain('已是最新');
  });

  it('doctor 所有必要項目通過', async () => {
    const { checks } = await runChecks({ includeDaemon: false, checkLogin: false });
    const failed = checks.filter((c) => !c.ok && !c.optional);
    expect(failed).toEqual([]);
  });

  it('移除後設定完全還原，資料保留', async () => {
    await uninstall({ mcpViaFile: true, shortcuts: false, yes: true, log: quiet });
    expect(JSON.parse(readFileSync(join(env.claude, 'settings.json'), 'utf8'))).toEqual(USER_SETTINGS);
    expect(readFileSync(join(env.claude, 'CLAUDE.md'), 'utf8')).toBe(USER_MD);
    expect(existsSync(join(env.claude, 'commands', 'worklog.md'))).toBe(false);
    expect(JSON.parse(readFileSync(join(env.claude, '.claude.json'), 'utf8')).mcpServers.worktrail).toBeUndefined();
    expect(existsSync(join(env.home, 'pointer.json'))).toBe(false);
    expect(existsSync(join(env.storage, 'config.yaml'))).toBe(true);
  });

  it('不覆寫使用者自己同名的指令檔', async () => {
    writeFileSync(join(env.claude, 'commands', 'worklog.md'), '我自己的指令');
    await install({ storage: env.storage, yes: true, shortcuts: false, mcpViaFile: true, log: quiet });
    expect(readFileSync(join(env.claude, 'commands', 'worklog.md'), 'utf8')).toBe('我自己的指令');
    await uninstall({ mcpViaFile: true, shortcuts: false, yes: true, log: quiet });
    expect(readFileSync(join(env.claude, 'commands', 'worklog.md'), 'utf8')).toBe('我自己的指令');
  });
});
