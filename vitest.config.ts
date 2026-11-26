import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 部分測試會實際啟動 git、node 與假的 claude CLI；Windows 忙碌時單次啟動就可能超過 1 秒
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { include: ['src/core/**'], reporter: ['text'] },
  },
});
