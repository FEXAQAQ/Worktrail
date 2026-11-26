import { z } from 'zod';

export const PromptType = z.enum(['summary', 'weekly', 'performance', 'talk']);
export type PromptType = z.infer<typeof PromptType>;

/** 規格 9.3：prompt 範本檔前段 YAML */
export const PromptFrontmatter = z.object({
  name: z.string().min(1),
  type: PromptType,
  description: z.string().default(''),
});
export type PromptFrontmatter = z.infer<typeof PromptFrontmatter>;

/** 規格 9.4：各類型可用的變數 */
export const PROMPT_VARIABLES: Record<PromptType, readonly string[]> = {
  summary: ['today', 'user_name', 'transcript', 'draft', 'previous_items'],
  weekly: ['period', 'period_start', 'period_end', 'today', 'user_name', 'records', 'stats', 'previous'],
  performance: ['period', 'period_start', 'period_end', 'today', 'user_name', 'records', 'stats', 'previous'],
  /** 小交流：勾選的日期不一定連續 */
  talk: ['dates', 'period', 'period_start', 'period_end', 'today', 'user_name', 'records', 'stats', 'previous'],
};
