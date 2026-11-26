import { describe, expect, it } from 'vitest';
import { formatRecords } from '../src/core/prompt/format.js';
import { defaultConfig } from '../src/core/schema/config.js';
import type { Task } from '../src/core/schema/task.js';
import { computeStats } from '../src/core/stats/index.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { applyTaskPatch } from '../src/core/sync/task-edit.js';
import { groupMerged, markMerged, mergeError, unmarkMerged } from '../src/core/sync/task-merge.js';

let n = 0;
const task = (o: Partial<Task>): Task => ({ ...emptyTask(`0000000${++n}-0000-4000-8000-000000000000`, '2026-11-17'), ...o });

describe('合併同專案任務', () => {
  const a = task({ project: '社交工程', ticket: 'TDDA-1869', title: '修 API', hours: 1.5, merged: true, items: [{ text: '修好排程', status: 'done' }] });
  const x = task({ project: '其他', title: '支援', hours: 1 });
  const b = task({ project: '社交工程', title: '寫測試', hours: 1, merged: true, body: '補了邊界\n第二行' });
  const c = task({ project: '社交工程', title: '未合併', hours: 2 });

  it('同一天同專案帶標記者收成一組，位置在第一個成員，未標記者各自一筆', () => {
    const e = groupMerged([a, x, b, c]);
    expect(e.map((v) => v.kind)).toEqual(['group', 'task', 'task']);
    expect(e[0]).toMatchObject({ kind: 'group', project: '社交工程', hours: 2.5 });
    expect(e[0]!.kind === 'group' && e[0]!.tasks.map((t) => t.title)).toEqual(['修 API', '寫測試']);
    // 別天的同專案不在同一組；只剩一個成員就當一般任務
    expect(groupMerged([a, { ...b, date: '2026-11-18' }]).map((v) => v.kind)).toEqual(['task', 'task']);
  });

  it('週報紀錄：專案標題下依任務列出子項；統計的任務數算一筆，時數不變', () => {
    const r = formatRecords([a, x, b]);
    expect(r).toContain('#### 社交工程｜2.5h（合併 2 個任務）');
    expect(r).toContain('- TDDA-1869 修 API｜1.5h\n  - [完成] 修好排程');
    expect(r).toContain('- 寫測試｜1h\n  - （尚未撰寫摘要）\n  > 補了邊界\n  > 第二行');
    expect(r).toContain('#### 其他｜支援｜1h');
    const s = computeStats([a, x, b]);
    expect(s.task_count).toBe(2);
    expect(s.total_hours).toBe(3.5);
  });

  it('合併只限同一天；合併鎖定專案；改專案即離開合併；可取消', () => {
    expect(mergeError([a])).toBe('至少選擇兩個任務');
    expect(mergeError([a, { ...b, date: '2026-11-18' }])).toBe('只能合併同一天的任務');
    expect(mergeError([a, b])).toBeNull();
    const m = markMerged(task({ project: '', project_unmapped: true }), '社交工程');
    expect(m).toMatchObject({ merged: true, project: '社交工程', locked_fields: ['project'] });
    expect(m.project_unmapped).toBeUndefined();
    expect(unmarkMerged(m).merged).toBeUndefined();
    expect(applyTaskPatch(m, { project: '其他' }, defaultConfig()).task.merged).toBeUndefined();
    expect(applyTaskPatch(m, { title: '改標題' }, defaultConfig()).task.merged).toBe(true);
  });
});
