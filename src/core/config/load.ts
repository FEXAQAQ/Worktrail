/**
 * 規格 10：讀取 config.yaml。格式錯誤時改用預設值運作，並回報錯誤與行號。
 */
import { parseDocument } from 'yaml';
import { Config, defaultConfig } from '../schema/config.js';

export interface ConfigLoadResult {
  config: Config;
  /** 有值代表檔案有誤，config 已改用預設值 */
  error?: { message: string; line?: number };
}

export function parseConfig(text: string): ConfigLoadResult {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    return {
      config: defaultConfig(),
      error: { message: e.message, line: e.linePos?.[0]?.line },
    };
  }
  const raw: unknown = doc.toJS() ?? {};
  const r = Config.safeParse(raw);
  if (r.success) return { config: r.data };

  const issue = r.error.issues[0]!;
  let line: number | undefined;
  const node = doc.getIn(issue.path as (string | number)[], true) as { range?: [number, number, number] } | undefined;
  if (node?.range) line = text.slice(0, node.range[0]).split('\n').length;
  return {
    config: defaultConfig(),
    error: { message: `${issue.path.join('.') || '(root)'}: ${issue.message}`, line },
  };
}
