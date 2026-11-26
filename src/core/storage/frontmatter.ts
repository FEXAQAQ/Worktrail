/**
 * Markdown 前段 YAML 的讀寫。使用 `yaml` 套件的 core schema：日期維持字串，不會被轉成 Date。
 */
import { parse, stringify } from 'yaml';

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface FrontmatterDoc {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(text: string): FrontmatterDoc {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text };
  const data = parse(m[1]!) as unknown;
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    body: m[2]!.replace(/^\r?\n/, ''),
  };
}

/** 移除 undefined 欄位，保持輸出整潔 */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = clean(x);
    return o;
  }
  return v;
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = stringify(clean(data), { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
  const b = body.trim() ? `\n${body.replace(/^\n+/, '').replace(/\s*$/, '')}\n` : '';
  return `---\n${yaml}---\n${b}`;
}
