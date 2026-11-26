import { z } from 'zod';
import { IsoDate, IsoDateTime } from './task.js';

/**
 * 小交流檔前段 YAML（規格未涵蓋，見 DECISIONS.md）。
 * 與週報不同，期間是使用者勾選的幾天，不一定連續，所以存 dates 而不是起訖日。
 */
export const TalkFrontmatter = z.object({
  schema: z.literal(1),
  type: z.literal('talk'),
  title: z.string().default(''),
  dates: z.array(IsoDate).default([]),
  prompt: z.string().default('manual'),
  prompt_hash: z.string().default('manual'),
  sources: z.array(z.string()).default([]),
  sources_version: z.string().optional(),
  stats: z.record(z.string(), z.unknown()).default({}),
  created_at: IsoDateTime,
  generated_at: IsoDateTime.optional(),
  edited: z.boolean().default(false),
});
export type TalkFrontmatter = z.infer<typeof TalkFrontmatter>;

export interface Talk extends TalkFrontmatter {
  body: string;
}
