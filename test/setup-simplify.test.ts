import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { suggestTicketKeys } from '../src/core/capture/ticket.js';
import { parseAuthStatus } from '../src/core/claude-cli/index.js';
import { currentBuild, isOutdated, type DaemonInfo } from '../src/daemon/client.js';
import { makeEnv, type TestEnv } from './env.js';

describe('偵測新的 Jira 專案代碼', () => {
  const task = (branch: string, commits: string[] = [], title = '') => ({ branch, title, commits: commits.map((message) => ({ message })) });

  it('分支出現一次就建議；只在 commit／標題出現要 2 個任務以上', () => {
    const r = suggestTicketKeys(
      [
        task('feature/BMS-12_login'),
        task('main', ['fix: OPS-3 修正']),
        task('main', [], '處理 OPS-7'),
        task('main', ['docs: WEB-1']),
        task('feature/TDDA-1869'),
      ],
      ['TDDA'],
    );
    expect(r.map((s) => s.key)).toEqual(['BMS', 'OPS']);
    expect(r.find((s) => s.key === 'BMS')).toMatchObject({ branch_tasks: 1, tasks: 1, example: { ticket: 'BMS-12', source: 'branch' } });
    expect(r.find((s) => s.key === 'OPS')).toMatchObject({ tasks: 2, branch_tasks: 0 });
  });

  it('已加入、已忽略與常見的非單號代碼不建議', () => {
    const r = suggestTicketKeys(
      [task('feature/UTF-8'), task('fix/SHA-256'), task('fix/CVE-2024'), task('feature/BMS-1'), task('feature/OPS-2')],
      ['TDDA'],
      ['OPS'],
    );
    expect(r.map((s) => s.key)).toEqual(['BMS']);
  });

  it('同一個任務多次出現只算一次', () => {
    const r = suggestTicketKeys([task('feature/BMS-1', ['BMS-1 a', 'BMS-1 b'], 'BMS-1')], []);
    expect(r[0]).toMatchObject({ key: 'BMS', tasks: 1, branch_tasks: 1 });
  });
});

describe('Claude 登入狀態', () => {
  it('解析 claude auth status --json', () => {
    expect(parseAuthStatus('{"loggedIn": true, "authMethod": "claude.ai"}')).toBe(true);
    expect(parseAuthStatus('{"loggedIn": false}')).toBe(false);
    expect(parseAuthStatus('error: unknown command')).toBeNull();
    expect(parseAuthStatus('{"other": 1}')).toBeNull();
  });
});

describe('更新後辨識舊版服務', () => {
  let env: TestEnv;
  let cli: string;
  beforeAll(() => {
    env = makeEnv({ install: false });
    cli = join(env.dir, 'cli.cjs');
    writeFileSync(cli, '// build');
  });
  afterAll(() => env.cleanup());

  it('cli.cjs 重新建置後，服務記錄的 build 不同就視為過期；沒有記錄 build 的舊服務也視為過期', () => {
    const info: DaemonInfo = { pid: 1, port: 4870, token: 't', started_at: '', version: '0.1.0', build: currentBuild(cli) };
    expect(isOutdated(info, cli)).toBe(false);
    const later = new Date(Date.now() + 60_000);
    utimesSync(cli, later, later);
    expect(isOutdated(info, cli)).toBe(true);
    expect(isOutdated({ ...info, build: undefined }, cli)).toBe(true);
    expect(isOutdated(info, join(env.dir, 'missing.cjs'))).toBe(false);
  });
});
