/**
 * 規格 6.5：專案對應。
 */
import type { ProjectRule } from '../schema/config.js';
import { lineageKeys, type TicketInfo } from '../ticket-info/index.js';

/** 正規化路徑：反斜線轉斜線、移除結尾斜線、Windows 磁碟代號大寫、`/c/...` 轉 `C:/...` */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/');
  const msys = process.platform === 'win32' ? /^\/([a-zA-Z])\/(.*)$/.exec(s) : null;
  if (msys) s = `${msys[1]}:/${msys[2]}`;
  s = s.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
  if (s.length > 1 && s.endsWith('/') && !/^[A-Z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

/**
 * 將萬用字元轉成正規表示式：`**` 跨多層資料夾、`*` 單層、`?` 單一字元。
 * Windows 路徑不分大小寫。
 */
export function globToRegExp(glob: string, caseInsensitive = true): RegExp {
  let g = normalizePath(glob);
  // 結尾的 `/**` 等同資料夾本身及其所有內容，交給下方的子資料夾後綴處理
  if (g.endsWith('/**')) g = g.slice(0, -3);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // 規則比對資料夾時，也要涵蓋其子資料夾
  return new RegExp(`^${re}(?:/.*)?$`, caseInsensitive ? 'i' : '');
}

export function matchPath(path: string, glob: string): boolean {
  return globToRegExp(glob, process.platform === 'win32' || /^[A-Za-z]:/.test(path)).test(normalizePath(path));
}

export interface ProjectResult {
  project: string;
  /** 符合的專案規則 ID；未對應時沒有 */
  project_id?: string;
  /** 沒有任何規則符合：使用最上層卡片標題或資料夾名稱 */
  unmapped: boolean;
  rule?: 'parent' | 'path' | 'ticket_key';
}

/**
 * 比對順序（見 DECISIONS「專案分類順序」）：
 * 1. 父卡片：單號本身或其上層卡片列在規則的 `match.parents`。
 * 2. 工作目錄路徑。
 * 3. 單號的專案代碼。
 * 4. 都不符合：有上層卡片時用最上層卡片的標題，否則用資料夾名稱。
 */
export function resolveProject(args: {
  cwd: string | undefined;
  ticket: string | null;
  rules: readonly ProjectRule[];
  /** 單號資訊快取中的這張單；沒有時略過父卡片規則 */
  ticketInfo?: TicketInfo;
}): ProjectResult {
  const { cwd, ticket, rules, ticketInfo } = args;
  const hit = (r: ProjectRule, rule: ProjectResult['rule']): ProjectResult => ({ project: r.name, project_id: r.id, unmapped: false, rule });
  // 父卡片最能代表工作所屬的專案：同一個 repo 常同時處理不同 Epic 的單
  if (ticket) {
    const lineage = lineageKeys(ticket.toUpperCase(), ticketInfo);
    for (const r of rules) {
      const parents = r.match.parents.map((p) => p.trim().toUpperCase());
      if (lineage.some((k) => parents.includes(k))) return hit(r, 'parent');
    }
  }
  // 路徑規則優先於單號規則（同一 Jira 代碼可能對應多個工作專案）
  if (cwd) {
    for (const r of rules) {
      if (r.match.paths.some((g) => matchPath(cwd, g))) return hit(r, 'path');
    }
  }
  if (ticket) {
    const key = ticket.split('-')[0]!.toUpperCase();
    for (const r of rules) {
      if (r.match.ticket_keys.some((k) => k.toUpperCase() === key)) return hit(r, 'ticket_key');
    }
  }
  const top = ticketInfo?.ancestors.at(-1);
  if (top?.summary.trim()) return { project: top.summary.trim(), unmapped: true };
  const folder = cwd ? (normalizePath(cwd).split('/').filter(Boolean).pop() ?? '') : '';
  return { project: folder, unmapped: true };
}
