import { z } from 'zod';
import { IsoDate, IsoDateTime } from './task.js';

export const ReportType = z.enum(['weekly', 'performance']);
export type ReportType = z.infer<typeof ReportType>;

/** 規格 4.4：週報與績效共用的報告檔前段 YAML */
export const ReportFrontmatter = z.object({
  schema: z.literal(1),
  type: ReportType,
  period_start: IsoDate,
  period_end: IsoDate,
  prompt: z.string().min(1),
  prompt_hash: z.string().min(1),
  sources: z.array(z.string()).default([]),
  stats: z.record(z.string(), z.unknown()).default({}),
  generated_at: IsoDateTime,
  edited: z.boolean().default(false),
  stale: z.boolean().default(false),
});
export type ReportFrontmatter = z.infer<typeof ReportFrontmatter>;

export interface Report extends ReportFrontmatter {
  body: string;
}
