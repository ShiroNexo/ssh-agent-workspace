import { z } from 'zod';
import { ToolConfigManager } from '../core/ToolConfigManager.js';

export const toolsConfigTool = {
  name: 'tools_config',
  description:
    'Manage tool enable/disable state. Use to disable tools you do not need, reducing token overhead in the MCP tool list. tools_config itself cannot be disabled.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'enable', 'disable', 'reset'],
        description: 'list=show all, enable/disable=toggle one, reset=re-enable all',
      },
      tool: {
        type: 'string',
        description: 'Tool name (required for enable/disable)',
      },
    },
    required: ['action'],
  },
};

const schema = z.object({
  action: z.enum(['list', 'enable', 'disable', 'reset']),
  tool: z.string().optional(),
});

export async function handleToolsConfig(
  args: unknown,
  toolConfigManager: ToolConfigManager
) {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        { type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` },
      ],
      isError: true,
    };
  }

  const { action, tool } = parsed.data;

  switch (action) {
    case 'list': {
      const entries = toolConfigManager.getAll();
      const list = Object.entries(entries).map(([name, enabled]) => ({
        tool: name,
        enabled,
      }));
      return {
        content: [
          {
            type: 'text' as const,
            text: list.length > 0 ? JSON.stringify(list, null, 2) : 'All tools enabled (default)',
          },
        ],
      };
    }
    case 'enable': {
      if (!tool) {
        return {
          content: [
            { type: 'text' as const, text: 'Error: "tool" parameter required for enable' },
          ],
          isError: true,
        };
      }
      toolConfigManager.setEnabled(tool, true);
      return {
        content: [{ type: 'text' as const, text: `Tool '${tool}' enabled` }],
      };
    }
    case 'disable': {
      if (!tool) {
        return {
          content: [
            { type: 'text' as const, text: 'Error: "tool" parameter required for disable' },
          ],
          isError: true,
        };
      }
      if (tool === 'tools_config') {
        return {
          content: [
            { type: 'text' as const, text: 'Error: Cannot disable tools_config itself' },
          ],
          isError: true,
        };
      }
      toolConfigManager.setEnabled(tool, false);
      return {
        content: [{ type: 'text' as const, text: `Tool '${tool}' disabled` }],
      };
    }
    case 'reset': {
      toolConfigManager.reset();
      return {
        content: [
          { type: 'text' as const, text: 'All tools reset to enabled (default)' },
        ],
      };
    }
  }
}
