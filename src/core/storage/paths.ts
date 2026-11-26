/**
 * 規格 4.1、10：路徑解析。
 *
 * - `~/.worktrail/`：指標檔（pointer.json）與常駐服務資訊（daemon.json）。
 * - `<storage_root>/`：使用者資料（任務、報告、範本、設定）。
 * 環境變數 WORKTRAIL_HOME、CLAUDE_CONFIG_DIR 可覆寫，供測試與特殊環境使用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function worktrailHome(): string {
  return process.env.WORKTRAIL_HOME || join(homedir(), '.worktrail');
}

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function defaultStorageRoot(): string {
  return join(homedir(), 'Worktrail');
}

export const pointerPath = () => join(worktrailHome(), 'pointer.json');
export const daemonInfoPath = () => join(worktrailHome(), 'daemon.json');

export interface Pointer {
  storage_root: string;
}

/** 讀取儲存資料夾位置；未安裝時回傳 null */
export function readPointer(): Pointer | null {
  try {
    const p = JSON.parse(readFileSync(pointerPath(), 'utf8')) as Partial<Pointer>;
    return typeof p.storage_root === 'string' && p.storage_root ? { storage_root: p.storage_root } : null;
  } catch {
    return null;
  }
}

export function storageRoot(): string | null {
  return readPointer()?.storage_root ?? null;
}

export class StoragePaths {
  constructor(readonly root: string) {}
  get config() {
    return join(this.root, 'config.yaml');
  }
  get tasks() {
    return join(this.root, 'tasks');
  }
  get weekly() {
    return join(this.root, 'weekly');
  }
  get performance() {
    return join(this.root, 'performance');
  }
  /** 小交流 */
  get talk() {
    return join(this.root, 'talk');
  }
  get prompts() {
    return join(this.root, 'prompts');
  }
  get internal() {
    return join(this.root, '.worktrail');
  }
  get state() {
    return join(this.internal, 'state.json');
  }
  get logs() {
    return join(this.internal, 'logs');
  }
  get trash() {
    return join(this.internal, 'trash');
  }
  /** Worktrail 自己執行 claude -p 的工作目錄（補漏掃描會排除） */
  get claudeRuns() {
    return join(this.internal, 'claude-runs');
  }
  taskDir(date: string) {
    return join(this.tasks, date.slice(0, 4), date.slice(5, 7));
  }
  taskFile(id: string, date: string) {
    return join(this.taskDir(date), `${id}.md`);
  }
  reportDir(type: 'weekly' | 'performance') {
    return type === 'weekly' ? this.weekly : this.performance;
  }
  promptFile(type: string, name: string) {
    return join(this.prompts, type, `${name}.md`);
  }
  exists() {
    return existsSync(this.root);
  }
}
