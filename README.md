# dynamic-ssh-mcp

> Production-grade MCP server for AI-driven remote server management via persistent tmux-backed SSH sessions.

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js" alt="Node.js ≥18">
  <img src="https://img.shields.io/badge/MCP-Server-orange" alt="MCP">
  <img src="https://img.shields.io/badge/Tools-25-blue" alt="25 tools">
  <img src="https://img.shields.io/badge/npm-v1.0.0-red?logo=npm" alt="npm">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="platform">
</p>

---

## Why dynamic-ssh-mcp?

Most SSH MCP servers execute one-off commands that **discard state** — no shell context, no history, no running processes. `dynamic-ssh-mcp` wraps every session in a **persistent tmux buffer**: your AI agent gets a real interactive terminal that survives MCP restarts, SSH drops, and network hiccups.

**Session identity (cwd, env, history, running vim/htop/docker attach) is preserved across disconnections.**

| | dynamic-ssh-mcp | Typical SSH MCP |
|---|---|---|
| **Session model** | Persistent tmux session | One-off exec channel |
| **State** | cwd, env, history, running processes | None |
| **Prompt detection** | Deterministic custom PS1 | Fixed sleep / guess |
| **Session recovery** | Auto-restore on startup | Manual reconnect |
| **Security** | 3-layer (global + per-host + per-command) | Basic |
| **Tokens (25 tools)** | ~2,800 | ~43,500 (37 tools, mcp-ssh-manager) |

```
OpenCode / Claude Code
        │
        │ MCP stdio (JSON-RPC)
        ▼
dynamic-ssh-mcp (Node.js)
        │
        │ ssh2 per-tool / session
        ▼
tmux session on remote host (bash/zsh)
   └── PS1='__MCP_PROMPT__> '
```

---

## Quick Start

### Prerequisites

- **Local:** Node.js ≥18, npm
- **Remote:** tmux installed, bash or zsh shell, OpenSSH server
- **Auth:** SSH key-based auth, host aliases in `~/.ssh/config`

### Install

#### From npm (recommended)

```bash
npm install -g dynamic-ssh-mcp
```

Then use `dynamic-ssh-mcp` directly in your MCP config.

#### From source

```bash
git clone https://github.com/ShiroNexo/dynamic-ssh-mcp.git
cd dynamic-ssh-mcp
npm install
npm run build
```

### Configure MCP Client

#### opencode.json

```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "LOG_LEVEL": "info",
        "MCP_SSH_RESTORE_SESSIONS": "true"
      }
    }
  }
}
```

#### Claude Code

```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["/absolute/path/to/dynamic-ssh-mcp/dist/index.js"]
    }
  }
}
```

### Verify

Start a chat and type: `connect to prod` — if it returns a `session_id`, you're ready.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `MCP_SSH_READONLY` | `false` | Global read-only: block all write operations |
| `MCP_SSH_ALLOWED_HOSTS` | `(all)` | Comma-separated host aliases: `prod,staging` |
| `MCP_SSH_DENYLIST_COMMANDS` | `(none)` | Global command blocklist: `rm -rf,shutdown` |
| `MCP_SSH_RESTORE_SESSIONS` | `true` | Auto-restore `mcp_*` tmux sessions on startup |

### SSH Config (`~/.ssh/config`)

Host aliases must exist in `~/.ssh/config`. Wildcard (`*`) entries are ignored.

```
Host prod
  HostName 10.0.0.5
  User deploy
  IdentityFile ~/.ssh/id_ed25519
  Port 22

Host staging
  HostName 10.0.0.10
  User deploy
  IdentityFile ~/.ssh/id_ed25519

Host internal
  HostName 172.16.0.50
  User admin
  IdentityFile ~/.ssh/internal
  ProxyJump bastion

Host bastion
  HostName jump.example.com
  User jumpuser
  IdentityFile ~/.ssh/bastion_ed25519
```

### Per-Host Security

Use `host_security` tool to set per-host policies (persisted to `~/.dynamic-ssh-mcp/host_security.json`):

```json
{
  "prod": { "readonly": true },
  "staging": { "deny_commands": ["shutdown", "reboot", "dd"] },
  "dev": { "allow_commands": ["ls", "cat", "ps", "docker ps", "git"] }
}
```

Per-host settings override global `MCP_SSH_READONLY` for that host only.

### Token Optimization

Disable unused tools with `tools_config` to shrink the MCP tool list:

```
tools_config disable db_query
tools_config disable sync
tools_config disable backup
```

Config persists at `~/.dynamic-ssh-mcp/tools.json`. `tools_config` itself cannot be disabled.

---

## Tools

### Session Management (9 tools)

| Tool | Description |
|---|---|
| `list_hosts` | List SSH aliases from `~/.ssh/config` |
| `connect` | Create persistent tmux-backed SSH session |
| `reconnect_to_tmux` | Reattach to existing tmux session (survives restarts) |
| `exec` | Send command, wait for prompt, return output |
| `send_input` | Send raw input, non-blocking |
| `read_output` | Capture tail of terminal pane |
| `interrupt` | Send Ctrl-C (SIGINT) or Ctrl-D (SIGTERM) |
| `disconnect` | Close session, optionally kill tmux |
| `list_sessions` | List all active sessions |

### File Transfer (3 tools)

| Tool | Description |
|---|---|
| `sftp_upload` | Upload local file to remote |
| `sftp_download` | Download remote file to local |
| `sftp_list` | List remote directory contents |

### Health & Monitoring (3 tools)

| Tool | Description |
|---|---|
| `connection_status` | SSH liveness + tmux session existence |
| `health_check` | CPU/RAM/disk/load/uptime via exec channel |
| `tail_log` | Read log tails with optional follow mode |

### DevOps (4 tools)

| Tool | Description |
|---|---|
| `deploy` | Upload → backup → chmod → chown → restart service |
| `backup` | Remote tar.gz archive → download → cleanup |
| `sync` | Rsync-lite via SFTP (bidirectional, dry-run) |

### SSH Tunnels (3 tools)

| Tool | Description |
|---|---|
| `ssh_tunnel_open` | Local port forward or SOCKS5 proxy |
| `ssh_tunnel_list` | List active tunnels |
| `ssh_tunnel_close` | Close tunnel, free port |

### Multi-Session & Database (2 tools)

| Tool | Description |
|---|---|
| `group_exec` | Execute command across many sessions (parallel/sequential) |
| `db_query` | Read-only MySQL/PostgreSQL/MongoDB via SSH exec |

### Security Management (2 tools)

| Tool | Description |
|---|---|
| `tools_config` | Enable/disable tools at runtime |
| `host_security` | Per-host read-only, command allow/denylist |

**Full schema and parameter reference:** [`docs/TOOLS.md`](docs/TOOLS.md)

---

## Prompt Stabilization

The `exec` tool uses **deterministic prompt detection** instead of fixed timeouts:

```
Send command → wait_ms grace → poll every 250ms → detect PS1 → capture output
```

On connect, the server injects `PS1='__MCP_PROMPT__> '` into the tmux session with retry + verification. The `exec` tool polls `tmux capture-pane` until this exact string appears — no guesswork, no arbitrary sleep.

---

## Session Lifecycle

```
connect(host)
  ├─ validate alias in ~/.ssh/config
  ├─ check host allowlist
  ├─ resolve ProxyJump (auto from SSH config or manual)
  ├─ open SSH connection (ssh2, key-based, 20s ready timeout)
  ├─ verify tmux is installed
  ├─ create tmux session: mcp_<host>_<8-char-random>
  ├─ detect shell (bash/zsh only)
  ├─ inject PS1='__MCP_PROMPT__> ' (retry + verify)
  ├─ apply options: history-limit=50000, mouse=off
  └─ register session + persist to ~/.dynamic-ssh-mcp/

Restore (on server start)
  ├─ list all mcp_* tmux sessions per host
  ├─ reconnect to each with fresh SSH connection
  ├─ verify prompt, inject if missing
  └─ register restored sessions
```

---

## Security Model

Three-layer defense:

| Layer | Mechanism | Scope |
|---|---|---|
| **Global** | `MCP_SSH_READONLY`, `MCP_SSH_ALLOWED_HOSTS`, `MCP_SSH_DENYLIST_COMMANDS` | Server-wide |
| **Per-Host** | `host_security` tool (`readonly`, `allow_commands`, `deny_commands`) | Individual host |
| **Per-Command** | SQL/Mongo keyword blocklist, path sanitization, shell escaping | Individual operation |

### Write tools blocked by read-only mode:

`exec`, `send_input`, `sftp_upload`, `sftp_download`, `deploy`, `backup`, `sync`, `group_exec`, `db_query`, `ssh_tunnel_open`

Read-only tools (always allowed): `list_hosts`, `connect`, `read_output`, `interrupt`, `disconnect`, `list_sessions`, `sftp_list`, `connection_status`, `health_check`, `tail_log`, `ssh_tunnel_close`, `ssh_tunnel_list`, `tools_config`, `host_security`

**Read [`docs/SECURITY.md`](docs/SECURITY.md) for the full security reference.**

---

## Project Structure

```
dynamic-ssh-mcp/
├── src/
│   ├── index.ts               # Entry point + session restore on startup
│   ├── server.ts              # MCP server setup, tool routing, tool filtering
│   ├── types/
│   │   └── index.ts           # TypeScript types (Session, SSHHostConfig)
│   ├── core/
│   │   ├── SessionManager.ts  # In-memory session registry + storage sync
│   │   ├── SSHManager.ts      # SSH connections, SFTP, exec, proxy-jump
│   │   ├── TmuxManager.ts     # tmux operations (create, capture, signal)
│   │   ├── StorageManager.ts  # Persistent session metadata (JSON file)
│   │   ├── ToolConfigManager.ts # Tool enable/disable runtime config
│   │   └── HostSecurityManager.ts # Per-host security config
│   ├── tools/
│   │   ├── connect.ts         # SSH connection + tmux bootstrap
│   │   ├── reconnect_to_tmux.ts # Reattach to existing tmux session
│   │   ├── exec.ts            # Command execution with prompt stabilization
│   │   ├── send_input.ts      # Raw input injection
│   │   ├── read_output.ts     # Pane capture
│   │   ├── interrupt.ts       # Signal delivery (Ctrl-C/D)
│   │   ├── disconnect.ts      # Graceful session teardown
│   │   ├── list_hosts.ts      # SSH config scanner
│   │   ├── list_sessions.ts   # Active session lister
│   │   ├── sftp_upload.ts     # File upload via SFTP
│   │   ├── sftp_download.ts   # File download via SFTP
│   │   ├── sftp_list.ts       # Remote directory listing
│   │   ├── connection_status.ts # Session health check
│   │   ├── health_check.ts    # System metrics (CPU/RAM/disk)
│   │   ├── tail_log.ts        # Log reader with follow mode
│   │   ├── ssh_tunnel.ts      # Port forwarding + SOCKS5
│   │   ├── deploy.ts          # Deployment pipeline
│   │   ├── backup.ts          # Remote archive + download
│   │   ├── sync.ts            # Rsync-lite via SFTP
│   │   ├── group_exec.ts      # Multi-session command execution
│   │   ├── db_query.ts        # Read-only SQL/Mongo queries
│   │   ├── tools_config.ts    # Tool enable/disable management
│   │   ├── host_security.ts   # Per-host security management
│   │   └── index.ts           # Barrel re-exports
│   └── utils/
│       ├── ansi.ts            # ANSI escape code stripping
│       ├── logger.ts          # Structured logging (pino → stderr)
│       ├── security.ts        # Read-only, allowlist, denylist, per-host checks
│       ├── ssh.ts             # SSH config builder (ssh-config → ssh2)
│       ├── sshConfig.ts       # ~/.ssh/config parser + ProxyJump detection
│       └── validation.ts      # Zod schemas + input sanitization
├── tests/
│   ├── SessionManager.test.ts
│   ├── StorageManager.test.ts
│   ├── TmuxManager.test.ts
│   ├── SSHManager.test.ts
│   ├── security.test.ts
│   └── tools.test.ts
├── docs/
│   ├── TOOLS.md              # Complete tool reference
│   └── SECURITY.md           # Security model & hardening guide
└── package.json
```

---

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

---

## Usage Examples

### Connect and execute

```
> connect host=prod
→ session_id: sess_abc12345, host: prod, tmux_session: mcp_prod_x1y2z3

> exec session_id=sess_abc12345 command="docker ps"
→ 3 containers running

> exec session_id=sess_abc12345 command="htop" wait_ms=500 max_wait_ms=3000
→ (interactive process runs in tmux)
```

### SFTP upload

```
> sftp_upload session_id=sess_abc12345 local_path="/path/to/config.json" remote_path="/etc/app/config.json"
→ Upload complete: /etc/app/config.json
```

### Health check (via SSH exec, doesn't touch tmux)

```
> health_check session_id=sess_abc12345
→ { cpu: { usage: 12.3 }, memory: { usage: 45.1 }, disk: [...], uptime: "14 days" }
```

### Proxy jump through bastion

```
> connect host=internal proxy_jump=bastion
→ (routes through bastion → internal)
```

### Deploy with pipeline

```
> deploy session_id=sess_abc12345 files=[{"local":"dist/app.js","remote":"/var/www/app.js"}] backup=true chmod="755" restart_service="nginx"
→ { status: "ok", backup: "/var/www/app.js.bak" }
```

### Multi-server command execution

```
> group_exec session_ids=["sess_abc","sess_def"] command="uptime"
→ [{ session_id: sess_abc, host: prod, status: ok, output: "..." },
    { session_id: sess_def, host: staging, status: ok, output: "..." }]
```

### Read-only database query

```
> db_query session_id=sess_abc12345 type=mysql database=mydb query="SELECT COUNT(*) FROM users"
→ [{ "COUNT(*)": 15423 }]
```

### Session survival

```
(SSH drops → tmux session persists on remote)
> reconnect_to_tmux host=prod tmux_session=mcp_prod_x1y2z3
→ session_id: sess_new789, reconnected successfully
(prompt restored, cwd, env, history intact)
```

---

## Troubleshooting

### No hosts listed

- Ensure `~/.ssh/config` exists and has `Host` entries (wildcard-only entries are ignored)
- Check file permissions: `chmod 600 ~/.ssh/config`

### Connection timeout / auth failure

```bash
ssh-add -l                    # Verify SSH agent has your key
ssh <alias>                   # Test manual SSH login
chmod 600 ~/.ssh/id_*         # Fix key permissions
```

### Unsupported shell

Only bash and zsh are supported. Change login shell on remote:

```bash
chsh -s /bin/bash
```

### Stale sessions after MCP crash

Old `mcp_*` tmux sessions persist on remote hosts. Clean them:

```bash
tmux list-sessions -F '#{session_name}' | grep '^mcp_' | xargs -I{} tmux kill-session -t {}
```

### Fresh install

```bash
rm -rf node_modules dist package-lock.json
npm install && npm run build
```

---

## License

MIT
