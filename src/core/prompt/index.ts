/**
 * 規格 9.3、9.4：prompt 範本的載入、儲存、變數填入。
 *
 * 範本以 `<type>/<name>` 識別。內建範本以 `<type>/builtin` 提供（唯讀）；
 * `<type>/default` 在使用者檔案不存在時退回內建範本。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROMPT_VARIABLES, PromptFrontmatter, PromptType } from '../schema/prompt.js';
import { parseFrontmatter } from '../storage/frontmatter.js';
import { readText, removeFile, shortHash, writeFileAtomic } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';
import type { Config } from '../schema/config.js';
import { BUILTIN_PROMPTS } from '../../templates/prompts.js';

export interface PromptTemplate {
  /** `<type>/<name>` */
  ref: string;
  type: PromptType;
  name: string;
  title: string;
  description: string;
  body: string;
  /** 完整檔案內容 */
  text: string;
  hash: string;
  builtin: boolean;
}

const NAME_RE = /^[\w\-一-鿿]+$/;

export function splitRef(ref: string): { type: PromptType; name: string } {
  const [type, name] = ref.split('/');
  const t = PromptType.safeParse(type);
  if (!t.success || !name || !NAME_RE.test(name)) throw new Error(`範本名稱不正確：${ref}（格式為 類型/名稱）`);
  return { type: t.data, name };
}

function fromText(ref: string, text: string, builtin: boolean): PromptTemplate {
  const { type, name } = splitRef(ref);
  const { data, body } = parseFrontmatter(text);
  const fm = PromptFrontmatter.safeParse({ type, ...data });
  return {
    ref,
    type,
    name,
    title: fm.success ? fm.data.name : name,
    description: fm.success ? fm.data.description : '',
    body: body.trim(),
    text,
    hash: shortHash(text),
    builtin,
  };
}

function builtinText(type: PromptType): string {
  return BUILTIN_PROMPTS[`${type}/default`];
}

/** default 以外的內建範本內容（不是則回傳 undefined） */
function extraBuiltin(ref: string): string | undefined {
  return ref.endsWith('/default') ? undefined : (BUILTIN_PROMPTS as Record<string, string>)[ref];
}

export function loadPrompt(paths: StoragePaths, ref: string): PromptTemplate {
  const { type, name } = splitRef(ref);
  if (name === 'builtin') return fromText(ref, builtinText(type), true);
  const text = readText(paths.promptFile(type, name));
  if (text !== null) return fromText(ref, text, false);
  if (name === 'default') return fromText(ref, builtinText(type), true);
  // 後來新增的內建範本（例如 summary/jira），舊安裝還沒有檔案：以內建內容提供，仍可編輯，儲存時才建立檔案
  const extra = extraBuiltin(ref);
  if (extra) return fromText(ref, extra, false);
  throw new Error(`找不到範本：${ref}`);
}

export function listPrompts(paths: StoragePaths): PromptTemplate[] {
  const out: PromptTemplate[] = [];
  for (const type of PromptType.options) {
    out.push(fromText(`${type}/builtin`, builtinText(type), true));
    const dir = join(paths.prompts, type);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue;
      const name = f.slice(0, -3);
      if (!NAME_RE.test(name) || name === 'builtin') continue;
      const text = readText(join(dir, f));
      if (text !== null) out.push(fromText(`${type}/${name}`, text, false));
    }
  }
  for (const ref of Object.keys(BUILTIN_PROMPTS)) {
    if (extraBuiltin(ref) && !out.some((p) => p.ref === ref)) out.push(loadPrompt(paths, ref));
  }
  return out;
}

/** 範本中使用的變數 */
export function usedVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]!))];
}

export function unknownVariables(body: string, type: PromptType): string[] {
  const known = new Set(PROMPT_VARIABLES[type]);
  return usedVariables(body).filter((v) => !known.has(v));
}

export interface PromptValidation {
  errors: string[];
  warnings: string[];
}

export function validatePrompt(ref: string, text: string): PromptValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let type: PromptType;
  try {
    type = splitRef(ref).type;
  } catch (e) {
    return { errors: [(e as Error).message], warnings };
  }
  const { data, body } = parseFrontmatter(text);
  const fm = PromptFrontmatter.safeParse({ ...data, type: data.type ?? type });
  if (!fm.success) errors.push(`前段 YAML 有誤：${fm.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`);
  else if (fm.data.type !== type) errors.push(`範本類型（${fm.data.type}）與資料夾（${type}）不一致`);
  if (type !== 'summary' && !usedVariables(body).includes('records')) {
    errors.push('週報、績效與小交流範本必須包含 {{records}}');
  }
  const unknown = unknownVariables(body, type);
  if (unknown.length) warnings.push(`未定義的變數：${unknown.map((v) => `{{${v}}}`).join('、')}（產生時保留原字樣）`);
  if (!body.trim()) errors.push('範本內文不可為空');
  return { errors, warnings };
}

export function savePrompt(paths: StoragePaths, ref: string, text: string): PromptTemplate {
  const { type, name } = splitRef(ref);
  if (name === 'builtin') throw new Error('內建範本為唯讀，請複製為新範本後修改');
  const v = validatePrompt(ref, text);
  if (v.errors.length) throw new Error(v.errors.join('\n'));
  writeFileAtomic(paths.promptFile(type, name), text.endsWith('\n') ? text : `${text}\n`);
  return loadPrompt(paths, ref);
}

export function deletePrompt(paths: StoragePaths, ref: string): void {
  const { type, name } = splitRef(ref);
  if (name === 'builtin') throw new Error('內建範本不可刪除');
  removeFile(paths.promptFile(type, name));
}

/** 只做字串取代；未提供的變數保留原字樣（規格 9.3） */
export function renderTemplate(body: string, vars: Record<string, string | undefined>): string {
  return body.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, name: string) => vars[name] ?? m);
}

/** 各類型目前設定的預設範本 */
export function defaultPromptRefs(config: Pick<Config, 'summary' | 'report'>): Record<PromptType, string> {
  return {
    summary: config.summary.default_prompt,
    weekly: config.report.weekly.default_prompt,
    performance: config.report.performance.default_prompt,
    talk: config.report.talk.default_prompt,
  };
}

/** 刪除範本前的檢查：目前的預設範本（內建的 default 除外）不能刪除，回傳錯誤訊息或 null */
export function promptDeleteError(config: Pick<Config, 'summary' | 'report'>, ref: string): string | null {
  const isDefault = Object.values(defaultPromptRefs(config)).includes(ref);
  return isDefault && !ref.endsWith('/default') ? '此範本是目前的預設範本，請先改用其他範本' : null;
}
