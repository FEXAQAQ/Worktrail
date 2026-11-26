/**
 * 規格 7：MCP Server（stdio）。Claude Code 每個 session 啟動一個程序。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from '../core/program.js';
import { writeLog } from '../core/storage/log.js';
import { StoragePaths, storageRoot } from '../core/storage/paths.js';
import { MCP_INSTRUCTIONS } from '../templates/claude.js';
import { isDaemonRunning, startDaemonDetached } from '../daemon/client.js';
import { descriptions, handlers, saveSummaryDescription, schemas, type ToolContext } from './tools.js';

export async function runMcpServer(): Promise<void> {
  const root = storageRoot();
  const server = new McpServer({ name: 'worktrail', version: VERSION }, { instructions: MCP_INSTRUCTIONS });
  const paths = root ? new StoragePaths(root) : null;
  const ctx = (): ToolContext => {
    if (!paths) throw new Error('Worktrail 尚未安裝：請執行 worktrail install');
    return { paths, cwd: process.cwd() };
  };

  for (const name of Object.keys(schemas) as (keyof typeof schemas)[]) {
    server.registerTool(
      name,
      { description: name === 'worklog_save_summary' ? saveSummaryDescription(paths) : descriptions[name], inputSchema: schemas[name] },
      async (args: Record<string, unknown>) => {
        try {
          const handler = handlers[name] as (c: ToolContext, a: unknown) => Promise<unknown>;
          const result = await handler(ctx(), args ?? {});
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (paths) writeLog(paths, `mcp:${name}`, 'warn', msg);
          return { isError: true, content: [{ type: 'text' as const, text: msg }] };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());

  // 常駐服務未執行時在背景啟動（不阻塞 MCP）
  if (paths) {
    void isDaemonRunning().then((up) => {
      if (!up) void startDaemonDetached().catch(() => undefined);
    });
  }
}
