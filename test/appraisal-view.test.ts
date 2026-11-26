import { describe, expect, it } from 'vitest';
import { appraisalTitle, parseAppraisal } from '../ui/src/lib/appraisal.js';

const md = `# I. 工作專案與日常任務（2026-01-01 ～ 2026-12-31）

## 會員中心

### 專案/日常任務
會員中心

### 執行內容/要項
一、 手機號碼登入 (SHOP-451)
- 簡訊驗證碼： 加上**限流**

二、 個資保護
- 匯出遮罩

### 請描述達成狀況
情境 (Situation) : 只支援 Email 登入

量化成果 (Result) :
1. 上線：
- 136h

## 金流整合

### 執行內容/要項
一、 LINE Pay 退款

### 請描述達成狀況
情境 (Situation) : 人工對帳
`;

describe('年度考核表：解析成表格列', () => {
  it('每個專案一列，三欄內容保留原文排版', () => {
    const rows = parseAppraisal(md)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      project: '會員中心',
      items: '一、 手機號碼登入 (SHOP-451)\n- 簡訊驗證碼： 加上限流\n\n二、 個資保護\n- 匯出遮罩',
      result: '情境 (Situation) : 只支援 Email 登入\n\n量化成果 (Result) :\n1. 上線：\n- 136h',
    });
  });

  it('缺少「專案/日常任務」欄時以專案標題代替', () => {
    expect(parseAppraisal(md)![1]!.project).toBe('金流整合');
  });

  it('Windows 換行也能解析', () => {
    expect(parseAppraisal(md.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });

  it('一般績效報告不是考核表結構，回傳 null', () => {
    expect(parseAppraisal('# 績效總結\n## 主要成果\n- 完成 A\n## 專案投入\n- B')).toBeNull();
    expect(parseAppraisal('')).toBeNull();
  });

  it('取出標題', () => {
    expect(appraisalTitle(md)).toBe('I. 工作專案與日常任務（2026-01-01 ～ 2026-12-31）');
    expect(appraisalTitle('沒有標題')).toBeNull();
  });
});
