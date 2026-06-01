import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { logger } from '../utils/logger.js';

export const healthCheckSchema = z.object({
  session_id: z.string().min(1),
});

export const healthCheckTool = {
  name: 'health_check',
  description:
    'Run a system health check on the remote host via an SSH exec channel (non-interactive). Returns structured CPU, RAM, disk, load, and uptime metrics.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect',
      },
    },
    required: ['session_id'],
  },
};

function parseMemory(line: string): { total_kb: number; used_kb: number; free_kb: number } | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length >= 4 && parts[0] === 'Mem:') {
    return {
      total_kb: parseInt(parts[1], 10) || 0,
      used_kb: parseInt(parts[2], 10) || 0,
      free_kb: parseInt(parts[3], 10) || 0,
    };
  }
  return null;
}

export async function handleHealthCheck(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager
) {
  const parsed = healthCheckSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { session_id } = parsed.data;
  const session = sessionManager.get(session_id);

  if (!session) {
    return {
      content: [{ type: 'text' as const, text: `Error: Session '${session_id}' not found or has been disconnected` }],
      isError: true,
    };
  }

  if (!sshManager.isAlive(session.ssh)) {
    return {
      content: [{ type: 'text' as const, text: `Error: SSH connection for session '${session_id}' is dead` }],
      isError: true,
    };
  }

  const result: Record<string, unknown> = {
    session_id,
    host: session.host,
    timestamp: new Date().toISOString(),
  };

  const script = `uptime && echo "==CPU==" && top -bn1 | head -5 && echo "==MEM==" && free -m 2>/dev/null || free 2>/dev/null || cat /proc/meminfo 2>/dev/null | head -5 && echo "==DISK==" && df -h / 2>/dev/null || df -h 2>/dev/null | head -10 && echo "==LOAD==" && cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null`;

  try {
    const execResult = await sshManager.exec(session.ssh, script, 10000);

    result.exit_code = execResult.code;

    const stdout = execResult.stdout || '';

    const uptimeMatch = stdout.match(/^(.*?)\n==CPU==/s);
    if (uptimeMatch) {
      result.uptime = uptimeMatch[1].trim();
    }

    const cpuSection = stdout.match(/==CPU==\n([\s\S]*?)(?=\n==\w+==|$)/);
    if (cpuSection) {
      const topLines = cpuSection[1].trim().split('\n');
      for (const line of topLines) {
        if (line.startsWith('%Cpu') || line.startsWith('%CPU') || line.includes('Cpu')) {
          const userMatch = line.match(/(\d+\.?\d*)\s*us/);
          const sysMatch = line.match(/(\d+\.?\d*)\s*sy/);
          const idleMatch = line.match(/(\d+\.?\d*)\s*id/);
          result.cpu_user_pct = userMatch ? parseFloat(userMatch[1]) : null;
          result.cpu_sys_pct = sysMatch ? parseFloat(sysMatch[1]) : null;
          result.cpu_idle_pct = idleMatch ? parseFloat(idleMatch[1]) : null;
          if (result.cpu_idle_pct != null) {
            result.cpu_used_pct = Math.round((100 - (result.cpu_idle_pct as number)) * 100) / 100;
          }
          break;
        }
      }
    }

    const memSection = stdout.match(/==MEM==\n([\s\S]*?)(?=\n==\w+==|$)/);
    if (memSection) {
      const memLines = memSection[1].trim().split('\n');
      for (const line of memLines) {
        const parsed = parseMemory(line);
        if (parsed) {
          result.memory_total_mb = Math.round(parsed.total_kb / 1024);
          result.memory_used_mb = Math.round(parsed.used_kb / 1024);
          result.memory_free_mb = Math.round(parsed.free_kb / 1024);
          result.memory_used_pct = Math.round((parsed.used_kb / parsed.total_kb) * 10000) / 100;
          break;
        }
      }
      if (result.memory_total_mb == null) {
        for (const line of memLines) {
          const memTotal = line.match(/MemTotal:\s*(\d+)/);
          const memFree = line.match(/MemFree:\s*(\d+)/);
          const memAvail = line.match(/MemAvailable:\s*(\d+)/);
          if (memTotal) result.memory_total_mb = Math.round(parseInt(memTotal[1]) / 1024);
          if (memFree || memAvail) {
            const freeKb = memAvail ? parseInt(memAvail[1]) : parseInt(memFree![1]);
            result.memory_free_mb = Math.round(freeKb / 1024);
            if (result.memory_total_mb) {
              result.memory_used_mb = (result.memory_total_mb as number) - (result.memory_free_mb as number);
              result.memory_used_pct = Math.round(((result.memory_used_mb as number) / (result.memory_total_mb as number)) * 10000) / 100;
            }
          }
        }
      }
    }

    const diskSection = stdout.match(/==DISK==\n([\s\S]*?)(?=\n==\w+==|$)/);
    if (diskSection) {
      const diskLines = diskSection[1].trim().split('\n');
      const mounts: Record<string, unknown>[] = [];
      for (const line of diskLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6 && parts[0].startsWith('/')) {
          mounts.push({
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            use_pct: parts[4],
            mount: parts[5],
          });
        }
      }
      if (mounts.length > 0) result.disk_mounts = mounts;
    }

    const loadSection = stdout.match(/==LOAD==\n([\s\S]*?)(?=\n==\w+==|$)/);
    if (loadSection) {
      const loadLine = loadSection[1].trim();
      const loadParts = loadLine.split(/\s+/);
      if (loadParts.length >= 3) {
        result.load_1m = parseFloat(loadParts[0]);
        result.load_5m = parseFloat(loadParts[1]);
        result.load_15m = parseFloat(loadParts[2]);
      }
    }

    if (execResult.stderr) {
      result.stderr = execResult.stderr.slice(0, 500);
    }
  } catch (err) {
    logger.error({ sessionId: session_id, error: (err as Error).message }, 'Health check failed');
    return {
      content: [{ type: 'text' as const, text: `Error: Health check failed: ${(err as Error).message}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
