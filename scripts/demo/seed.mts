/**
 * README 示範用的虛構資料（電商團隊、單號 SHOP、三個專案、半年紀錄、一份週報與小交流）。
 * 用法：npx tsx scripts/demo/seed.mts <資料夾>　（通常由 scripts/demo/run.mjs 呼叫）
 * 資料夾內會建立 home/（WORKTRAIL_HOME）、claude/（CLAUDE_CONFIG_DIR）、storage/（儲存資料夾），不碰真實設定。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { initStorage } from '../../src/core/storage/init.js';
import { StoragePaths } from '../../src/core/storage/paths.js';
import { writeFileAtomic } from '../../src/core/storage/fsutil.js';
import { loadConfig, saveConfig } from '../../src/core/storage/config-store.js';
import { writeTask } from '../../src/core/storage/tasks.js';
import { taskId } from '../../src/core/schema/task.js';
import { prepareReport, saveReport } from '../../src/core/report/prepare.js';
import { createTalk, prepareTalk, saveGeneratedTalk } from '../../src/core/talk/index.js';

const ROOT = process.argv[2];
if (!ROOT) throw new Error('用法：npx tsx scripts/demo/seed.mts <資料夾>');
const PORT = Number(process.env.DEMO_PORT || 4879);

rmSync(ROOT, { recursive: true, force: true });
const home = join(ROOT, 'home');
const storage = join(ROOT, 'storage');
mkdirSync(home, { recursive: true });
mkdirSync(join(ROOT, 'claude', 'projects'), { recursive: true });
process.env.WORKTRAIL_HOME = home;
process.env.CLAUDE_CONFIG_DIR = join(ROOT, 'claude');
writeFileAtomic(join(home, 'pointer.json'), JSON.stringify({ storage_root: storage }));
const paths = new StoragePaths(storage);
initStorage(paths);

const base = loadConfig(paths).config;
const config = await saveConfig(paths, {
  ...base,
  user_name: 'Alex',
  ticket: { ...base.ticket, keys: ['SHOP'], fetch_parents: false, auto_projects: false },
  capture: { ...base.capture, guard: 'off' },
  ui: { ...base.ui, port: PORT, theme: 'light', style: 'default', onboarding: 'done' },
  projects: [
    { name: '會員中心', match: { paths: ['C:/demo/member-*'] } },
    { name: '金流整合', match: { paths: ['C:/demo/payment-*'] } },
    { name: '商品管理', match: { paths: ['C:/demo/admin-*'] } },
  ],
});
const pid = (name: string) => config.projects.find((p) => p.name === name)?.id;

type It = { text: string; status: 'done' | 'pending' | 'todo' | 'skipped' | 'blocked'; note?: string };
interface Spec {
  date: string;
  project: string;
  repo: string;
  ticket: string | null;
  title: string;
  start: string; // HH:mm
  minutes: number;
  hours: number;
  items: It[];
  commits?: string[];
  draft?: boolean;
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 7);
const addMin = (hhmm: string, m: number) => {
  const [h, mm] = hhmm.split(':').map(Number);
  const t = h * 60 + mm + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function put(s: Spec) {
  const sessionId = randomUUID();
  const end = addMin(s.start, Math.round(s.hours * 60));
  const commits = (s.commits ?? []).map((m, i) => ({
    sha: sha(s.date + m),
    message: m,
    time: `${s.date}T${addMin(s.start, Math.round(((i + 1) * s.hours * 60) / ((s.commits?.length ?? 1) + 1)))}:00+08:00`,
  }));
  writeTask(paths, {
    schema: 1,
    id: taskId(s.date, s.ticket, sessionId),
    session_id: sessionId,
    date: s.date,
    project: s.project,
    project_id: pid(s.project),
    ticket: s.ticket,
    related_tickets: [],
    title: s.title,
    title_source: s.draft ? 'jira' : 'summary',
    repo: s.repo,
    branch: s.ticket ? `feature/${s.ticket}` : 'main',
    first_activity: `${s.date}T${s.start}:00+08:00`,
    last_activity: `${s.date}T${end}:00+08:00`,
    active_minutes: s.minutes,
    hours: s.hours,
    hours_overridden: false,
    hours_source: s.draft ? 'computed' : 'ai',
    locked_fields: [],
    commits,
    summary_status: s.draft ? 'draft' : 'done',
    ...(s.draft ? {} : { summary_updated_at: `${s.date}T${end}:00+08:00`, summary_prompt: 'summary/default' }),
    items: s.draft ? [] : s.items,
    body: '',
  });
}

// 以今天為基準產生日期，重錄時畫面永遠是「今天」
const TODAY = process.env.DEMO_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: config.time.timezone }).format(new Date());
const shift = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const isWeekend = (date: string) => [0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay());
const slash = (date: string) => date.replace(/-/g, '/');

const M = 'C:\\demo\\member-api', P = 'C:\\demo\\payment-gateway', A = 'C:\\demo\\admin-portal';

// 今天
put({ date: TODAY, project: '金流整合', repo: P, ticket: 'SHOP-482', title: '信用卡分期付款：串接銀行分期 API', start: '09:20', minutes: 150, hours: 3,
  commits: ['SHOP-482 新增分期期數查詢', 'SHOP-482 分期交易建立與回呼驗章', 'SHOP-482 補上分期失敗的退款流程'],
  items: [
    { text: '新增分期期數查詢 API，依卡別回傳可用期數', status: 'done' },
    { text: '分期交易建立與銀行回呼驗章', status: 'done' },
    { text: '分期失敗時自動退款', status: 'done' },
    { text: '與銀行確認 24 期手續費計算方式', status: 'pending', note: '已寄信，等候回覆' },
    { text: '前台分期選單 UI', status: 'todo' },
  ] });
put({ date: TODAY, project: '會員中心', repo: M, ticket: 'SHOP-475', title: '會員等級：升降等排程改為每日批次', start: '13:40', minutes: 95, hours: 2,
  commits: ['SHOP-475 會員等級改為每日批次計算', 'SHOP-475 升降等通知改用佇列發送'],
  items: [
    { text: '等級計算由即時改為每日 02:00 批次', status: 'done' },
    { text: '升降等通知改用佇列，避免尖峰塞車', status: 'done' },
    { text: '舊資料回補腳本', status: 'blocked', note: '需 DBA 開正式區唯讀帳號' },
  ] });
put({ date: TODAY, project: '商品管理', repo: A, ticket: 'SHOP-490', title: '訂單匯出加入發票號碼欄位', start: '16:10', minutes: 40, hours: 1, draft: true, items: [] });

// 過去幾週：每個工作天 1～3 個任務
const pool: Omit<Spec, 'date' | 'start'>[] = [
  { project: '金流整合', repo: P, ticket: 'SHOP-460', title: 'LINE Pay 退款 API 串接', minutes: 180, hours: 3.5,
    commits: ['SHOP-460 LINE Pay 退款', 'SHOP-460 退款結果對帳'],
    items: [{ text: '串接 LINE Pay 退款 API', status: 'done' }, { text: '退款結果寫入對帳表', status: 'done' }, { text: '部分退款測試', status: 'pending' }] },
  { project: '金流整合', repo: P, ticket: 'SHOP-466', title: '金流對帳報表效能優化', minutes: 120, hours: 2.5,
    commits: ['SHOP-466 對帳查詢改用彙總表'],
    items: [{ text: '對帳查詢改用每日彙總表，查詢從 12 秒降到 0.8 秒', status: 'done' }, { text: '補上索引與執行計畫比對', status: 'done' }] },
  { project: '會員中心', repo: M, ticket: 'SHOP-451', title: '手機號碼登入與簡訊驗證碼', minutes: 210, hours: 4,
    commits: ['SHOP-451 簡訊驗證碼發送與限流', 'SHOP-451 手機號碼登入'],
    items: [{ text: '驗證碼發送與每分鐘限流', status: 'done' }, { text: '手機號碼登入流程', status: 'done' }, { text: '國際號碼格式', status: 'skipped', note: '本期只開放台灣門號' }] },
  { project: '會員中心', repo: M, ticket: 'SHOP-458', title: '會員資料匯出符合個資法要求', minutes: 100, hours: 2,
    commits: ['SHOP-458 會員資料匯出遮罩'],
    items: [{ text: '匯出檔個資欄位遮罩', status: 'done' }, { text: '匯出紀錄寫入稽核日誌', status: 'done' }] },
  { project: '商品管理', repo: A, ticket: 'SHOP-470', title: '商品批次上架工具', minutes: 150, hours: 3,
    commits: ['SHOP-470 CSV 批次上架', 'SHOP-470 上架前格式檢查'],
    items: [{ text: 'CSV 批次上架', status: 'done' }, { text: '上架前欄位與圖片檢查', status: 'done' }, { text: '上架結果寄送通知信', status: 'todo' }] },
  { project: '商品管理', repo: A, ticket: null, title: '週會與需求討論', minutes: 0, hours: 1,
    items: [{ text: '雙 11 檢討會議', status: 'done' }, { text: '整理下季需求優先順序', status: 'done' }] },
  { project: '會員中心', repo: M, ticket: 'SHOP-462', title: '修正生日禮券重複發送', minutes: 70, hours: 1.5,
    commits: ['SHOP-462 生日禮券發送加上冪等鍵'],
    items: [{ text: '找出排程重試造成重複發送', status: 'done' }, { text: '發送加上冪等鍵並補測試', status: 'done' }] },
];
const starts = ['09:10', '13:30', '15:50'];
let k = 0;
const day0 = new Date(shift(TODAY, -225) + 'T00:00:00Z');
for (let d = 0; ; d++) {
  const dt = new Date(day0.getTime() + d * 86400000);
  const date = dt.toISOString().slice(0, 10);
  if (date >= TODAY) break;
  const wd = dt.getUTCDay();
  if (wd === 0 || wd === 6) continue;
  const r = ((d * 2654435761) >>> 0) % 100; const recent = date >= shift(TODAY, -37); if (!recent && r < 30) continue; const n = recent ? 1 + ((d * 7 + 3) % 3) : 1 + (r % 3);
  for (let i = 0; i < n; i++) put({ ...pool[k++ % pool.length], date, start: starts[i] });
}

// 上週週報
const today = TODAY;
const prep = prepareReport({ paths, config, type: 'weekly', period: 'previous', today });
saveReport({
  paths, config, type: 'weekly', period: prep.period, prompt_name: prep.prompt_name, prompt_hash: prep.prompt_hash,
  sources: prep.sources, stats: prep.stats, sources_version: prep.sources_version,
  content: `# 週報 ${slash(prep.period.start)}–${slash(prep.period.end).slice(5)}

## 本週重點
- LINE Pay 退款上線，退款結果自動寫入對帳表，財務不必再手動核對
- 金流對帳報表查詢由 12 秒降到 0.8 秒
- 手機號碼登入完成，驗證碼發送加上限流
- 修正生日禮券重複發送，補上冪等鍵與測試

## 各專案進度
### 金流整合
- **SHOP-460** LINE Pay 退款：退款與對帳完成，部分退款測試進行中
- **SHOP-466** 對帳報表效能：改用每日彙總表，已上線

### 會員中心
- **SHOP-451** 手機號碼登入：登入流程與限流完成；國際號碼本期不處理
- **SHOP-462** 生日禮券：已修正並上線

### 商品管理
- **SHOP-470** 商品批次上架：CSV 上架與格式檢查完成，通知信待做

## 風險與阻礙
- 無

## 下週計畫
- 信用卡分期付款串接（SHOP-482）
- 會員等級改為每日批次（SHOP-475）
`,
});

// 小交流
const talkDates: string[] = [];
for (let d = TODAY; talkDates.length < 3; d = shift(d, -1)) if (!isWeekend(d) || d === TODAY) talkDates.unshift(d);
const talk = createTalk(paths, config, { dates: talkDates, title: '本週小交流', now: Date.parse(`${TODAY}T17:30:00+08:00`) });
const tp = prepareTalk({ paths, config, dates: talk.dates, excludeId: talk.id, today });
saveGeneratedTalk({
  paths, config, id: talk.id, prepared: tp,
  content: `# 小交流 ${slash(talkDates[0]!).slice(5)}–${slash(talkDates[2]!).slice(5)}

- **信用卡分期**（SHOP-482）：期數查詢、交易建立、失敗退款完成；24 期手續費等銀行回覆
- **會員等級**（SHOP-475）：改為每日批次＋佇列通知；舊資料回補等 DBA 帳號
- **商品批次上架**（SHOP-470）：CSV 上架與格式檢查完成
- **LINE Pay 退款**（SHOP-460）：部分退款測試中
`,
});

writeFileSync(join(ROOT, 'env.json'), JSON.stringify({ home, claude: join(ROOT, 'claude'), storage, today: TODAY, weekly: prep.id, port: PORT }));
console.log('seeded', storage);
