/**
 * 規格 13.2 第 3 步：建立資料夾結構、預設 config.yaml 與預設 prompt 範本。冪等。
 */
import { existsSync } from 'node:fs';
import { BUILTIN_PROMPTS } from '../../templates/prompts.js';
import { DEFAULT_CONFIG_YAML } from './config-store.js';
import { ensureDir, writeFileAtomic } from './fsutil.js';
import type { StoragePaths } from './paths.js';

export function initStorage(paths: StoragePaths): string[] {
  const created: string[] = [];
  for (const d of [paths.root, paths.tasks, paths.weekly, paths.performance, paths.talk, paths.internal, paths.logs]) {
    if (!existsSync(d)) created.push(d);
    ensureDir(d);
  }
  if (!existsSync(paths.config)) {
    writeFileAtomic(paths.config, DEFAULT_CONFIG_YAML);
    created.push(paths.config);
  }
  for (const [key, text] of Object.entries(BUILTIN_PROMPTS)) {
    const [type, name] = key.split('/') as [string, string];
    const file = paths.promptFile(type, name);
    if (!existsSync(file)) {
      writeFileAtomic(file, text);
      created.push(file);
    }
  }
  return created;
}
