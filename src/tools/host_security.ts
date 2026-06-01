import { z } from 'zod';
import { HostSecurityManager } from '../core/HostSecurityManager.js';

export const hostSecurityTool = {
  name: 'host_security',
  description:
    'Manage per-host security: set read-only mode, command allowlist or denylist per host. Per-host settings override the global MCP_SSH_READONLY env var for that host.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'remove'],
        description: 'get=view config, set=apply settings, remove=clear host config',
      },
      host: {
        type: 'string',
        description: 'Host alias from SSH config (required for set/remove)',
      },
      readonly: {
        type: 'boolean',
        description: 'Force read-only mode for this host (action=set)',
      },
      allow_commands: {
        type: 'array',
        items: { type: 'string' },
        description: 'Whitelist commands for this host (action=set)',
      },
      deny_commands: {
        type: 'array',
        items: { type: 'string' },
        description: 'Blacklist commands for this host (action=set)',
      },
    },
    required: ['action'],
  },
};

const schema = z.object({
  action: z.enum(['get', 'set', 'remove']),
  host: z.string().optional(),
  readonly: z.boolean().optional(),
  allow_commands: z.array(z.string()).optional(),
  deny_commands: z.array(z.string()).optional(),
});

export async function handleHostSecurity(
  args: unknown,
  hostSecurityManager: HostSecurityManager
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

  const { action, host, readonly, allow_commands, deny_commands } = parsed.data;

  switch (action) {
    case 'get': {
      if (host) {
        const cfg = hostSecurityManager.getHostConfig(host);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ host, config: cfg }, null, 2),
            },
          ],
        };
      }
      const all = hostSecurityManager.getAll();
      return {
        content: [
          {
            type: 'text' as const,
            text: Object.keys(all).length > 0
              ? JSON.stringify(all, null, 2)
              : 'No per-host security rules configured',
          },
        ],
      };
    }
    case 'set': {
      if (!host) {
        return {
          content: [
            { type: 'text' as const, text: 'Error: "host" parameter required for set' },
          ],
          isError: true,
        };
      }
      if (readonly !== undefined) {
        hostSecurityManager.setReadOnly(host, readonly);
      }
      if (allow_commands !== undefined) {
        hostSecurityManager.setAllowCommands(host, allow_commands);
      }
      if (deny_commands !== undefined) {
        hostSecurityManager.setDenyCommands(host, deny_commands);
      }
      const cfg = hostSecurityManager.getHostConfig(host);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ host, config: cfg }, null, 2),
          },
        ],
      };
    }
    case 'remove': {
      if (!host) {
        return {
          content: [
            { type: 'text' as const, text: 'Error: "host" parameter required for remove' },
          ],
          isError: true,
        };
      }
      hostSecurityManager.removeHost(host);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Host security config removed for '${host}'`,
          },
        ],
      };
    }
  }
}
