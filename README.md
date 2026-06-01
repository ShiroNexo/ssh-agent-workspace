# ssh-agent-workspace

> **Persistent SSH workspaces for AI agents.**
>
> Stateful tmux-backed sessions that survive reconnects, MCP restarts, and network drops — with runtime security policies and tool configuration.

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js" alt="Node.js ≥18">
  <img src="https://img.shields.io/badge/MCP-Server-orange" alt="MCP">
  <img src="https://img.shields.io/badge/Tools-25-blue" alt="25 tools">
  <img src="https://img.shields.io/badge/npm-v1.0.0-red?logo=npm" alt="npm">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="platform">
</p>

---

## The Problem

Every SSH MCP server runs commands in a **fresh shell**. That means:

```
❌ cwd resets every time
❌ env vars are gone
❌ shell history disappears
❌ vim / htop / docker attach break
❌ all state evaporates on reconnect
```

Your AI agent has to `cd`, re-export, re-configure before every single command — wasting tokens, time, and context.

---

## What ssh-agent-workspace Does

```
AI Agent
   │
   │ MCP stdio
   ▼
tmux workspace (persistent)
   ├─ cwd survives
   ├─ env survives
   ├─ history survives
   ├─ processes survive (vim, htop, docker attach...)
   ├─ auto-restore after MCP restart
   ├─ auto-restore after SSH drop
   ├─ runtime security per host
   └─ runtime tool enable/disable
```

Your agent gets a **real interactive terminal** — not one-off exec commands. It's like giving your AI its own tmux session that never dies.

---

## Comparison

| | ssh-agent-workspace | Typical SSH MCP |
|---|---|---|
| **Session model** | Persistent tmux workspace | Throwaway exec channel |
| **cwd / env / history** | Survives everything | Lost after each command |
| **Running processes** | Stay alive (vim, htop, etc.) | Killed immediately |
| **Reconnection** | Auto-restore on startup | Manual reconnect, fresh shell |
| **Prompt detection** | Deterministic custom PS1 | Blind sleep + guess |
| **Per-host security** | runtime `host_security` tool | Env vars only, restart required |
| **Tool management** | runtime `tools_config` (persistent) | None or env vars |
| **Token efficiency** | ~2,800 tokens (25 tools) | ~43,500 tokens (37 tools) |

---

## Quick Start

### Install

```bash
npm install -g ssh-agent-workspace
```

Or from source:

```bash
git clone https://github.com/ShiroNexo/dynamic-ssh-mcp.git
cd dynamic-ssh-mcp
npm install && npm run build
```

### Configure MCP Client

```json
{
  "mcpServers": {
    "workspace": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "MCP_SSH_RESTORE_SESSIONS": "true"
      }
    }
  }
}
```

### First session

```
> connect host=prod
→ { session_id: "sess_abc", tmux_session: "mcp_prod_x1y2z3" }
```

Your agent now has a persistent workspace on `prod`. Running `cd /var/www` once means the agent stays there for every subsequent command.

---

## Key Features

### Workspace Persistence

Every session is a **dedicated tmux session** on the remote host. Your agent's working directory, environment variables, shell history, and running processes persist across commands, disconnections, and server restarts.

```
connect → tmux workspace created with PS1='__MCP_PROMPT__> '
             │
exec "cd /var/www"    → prompt wait → output returned → cwd is now /var/www
exec "docker ps"      → runs in /var/www, no need to cd again
exec "vim app.js"     → vim opens and stays running in tmux

(SSH drops, MCP restarts...)

reconnect_to_tmux    → same tmux session, same cwd, vim still open
```

### Deterministic Output

Instead of `sleep 3 && capture`, every `exec` call polls `tmux capture-pane` until the exact prompt string `__MCP_PROMPT__>` appears. No race conditions, no false positives from output that looks like a prompt.

```
Send command → grace interval → poll every 250ms → prompt detected → capture → return output
```

### Auto-Recovery

On server start, `ssh-agent-workspace` scans all configured hosts for `mcp_*` tmux sessions and automatically reconnects. Disable with `MCP_SSH_RESTORE_SESSIONS=false`.

### Runtime Reconfiguration

| Tool | What it does |
|---|---|
| `tools_config` | Enable/disable any tool at runtime. Persistent. `tools_config` itself can never be disabled. |
| `host_security` | Set per-host read-only, command allowlist/denylist at runtime. Overrides global env vars per host. |

No restart needed. Changes apply immediately.

### Three-Layer Security

| Layer | Scope | Mechanism |
|---|---|---|
| **Global** | All hosts | `MCP_SSH_READONLY`, `MCP_SSH_ALLOWED_HOSTS`, `MCP_SSH_DENYLIST_COMMANDS` |
| **Per-Host** | Individual host | `host_security` tool: `readonly`, `allow_commands`, `deny_commands` |
| **Per-Operation** | Single command/query | SQL keyword blocklist, path sanitization, shell escaping |

---

## Tools (25)

### Workspace (9)

| Tool | Description |
|---|---|
| `connect` | Create persistent tmux workspace on remote host |
| `reconnect_to_tmux` | Reattach to existing workspace after disconnect |
| `exec` | Run command, wait for prompt, return output |
| `send_input` | Inject raw input (non-blocking) |
| `read_output` | Capture pane tail |
| `interrupt` | Ctrl-C / Ctrl-D signal |
| `disconnect` | Close session. Optionally kill tmux or keep alive |
| `list_hosts` | List `~/.ssh/config` aliases |
| `list_sessions` | List active workspaces |

### File Transfer (3)

| Tool | Description |
|---|---|
| `sftp_upload` | Upload file to remote |
| `sftp_download` | Download file from remote |
| `sftp_list` | List remote directory |

### Monitoring (3)

| Tool | Description |
|---|---|
| `connection_status` | SSH liveness + tmux existence |
| `health_check` | CPU / RAM / Disk / Load / Uptime |
| `tail_log` | Log tail with optional follow |

### DevOps (4)

| Tool | Description |
|---|---|
| `deploy` | Upload → backup → chmod → chown → restart |
| `backup` | tar.gz archive → download → cleanup |
| `sync` | Rsync-lite via SFTP (bidirectional, dry-run) |
| `ssh_tunnel_open` / `ssh_tunnel_list` / `ssh_tunnel_close` | Port forwarding + SOCKS5 |

### Cluster & Queries (2)

| Tool | Description |
|---|---|
| `group_exec` | Run command across multiple workspaces (parallel/sequential) |
| `db_query` | Read-only MySQL / PostgreSQL / MongoDB via SSH |

### Runtime Config (2)

| Tool | Description |
|---|---|
| `tools_config` | Enable/disable tools at runtime |
| `host_security` | Per-host read-only, command allow/denylist |

**Full reference:** [`docs/TOOLS.md`](docs/TOOLS.md) | **Security:** [`docs/SECURITY.md`](docs/SECURITY.md)

---

## Usage Examples

```
> connect host=prod
→ session_id: "sess_abc", tmux_session: "mcp_prod_x1y2z3"

> exec session_id=sess_abc command="cd /var/www && docker ps"
→ { output: "3 containers running" }

> exec session_id=sess_abc command="ls"
→ { output: "..." }  (cwd is still /var/www)

> group_exec session_ids=["sess_abc","sess_def"] command="uptime"
→ [{ host: "prod", output: "up 14 days" }, { host: "staging", output: "up 3 days" }]

> health_check session_id=sess_abc
→ { cpu: 12%, memory: 45%, disk: [{ "/": 56% }], uptime: "14 days" }

> db_query session_id=sess_abc type=mysql database=mydb query="SELECT COUNT(*) FROM users"
→ [{ "COUNT(*)": 15423 }]

> deploy session_id=sess_abc files=[{"local":"dist/app.js","remote":"/var/www/app.js"}] backup=true chmod="755" restart_service="nginx"

> host_security action=set host=prod readonly=true
→ Host 'prod' locked to read-only

> tools_config disable backup
→ Tool 'backup' disabled. Removed from MCP tool list.
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `MCP_SSH_READONLY` | `false` | Block all write operations globally |
| `MCP_SSH_ALLOWED_HOSTS` | `(all)` | Comma-separated host whitelist |
| `MCP_SSH_DENYLIST_COMMANDS` | `(none)` | Global command blocklist |
| `MCP_SSH_RESTORE_SESSIONS` | `true` | Auto-restore workspaces on startup |

### SSH Config

Hosts must be defined in `~/.ssh/config`:

```
Host prod
  HostName 10.0.0.5
  User deploy
  IdentityFile ~/.ssh/id_ed25519

Host internal
  HostName 172.16.0.50
  User admin
  ProxyJump bastion

Host bastion
  HostName jump.example.com
  User jumpuser
```
---

## Project Structure

```
src/
├── core/
│   ├── SessionManager.ts       # Session registry + persistence
│   ├── SSHManager.ts           # SSH2 connections, SFTP, proxy-jump
│   ├── TmuxManager.ts          # Tmux operations (create, capture, signal)
│   ├── StorageManager.ts       # Persistent session storage (JSON)
│   ├── ToolConfigManager.ts    # Runtime tool enable/disable
│   └── HostSecurityManager.ts  # Per-host security policies
├── tools/                      # 25 MCP tool handlers
└── utils/                      # Security, SSH config parsing, logging, validation
```

---

## Troubleshooting

```bash
ssh-add -l              # Verify SSH agent key
ssh <alias>             # Test manual login
chmod 600 ~/.ssh/id_*   # Fix key permissions

# Clean stale workspaces on remote
tmux ls | grep '^mcp_' | awk -F: '{print $1}' | xargs -I{} tmux kill-session -t {}
```

---

## License

MIT
