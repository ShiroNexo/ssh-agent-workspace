# ssh-agent-workspace

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js" alt="Node.js ≥18">
  <img src="https://img.shields.io/badge/MCP-Server-orange" alt="MCP">
  <img src="https://img.shields.io/badge/Tools-25-blue" alt="25 tools">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="platform">
</p>

**Stateful persistent workspace for AI agents over SSH.**

Unlike traditional SSH MCP servers that execute every command in a fresh shell, SSH Agent Workspace provides a tmux-backed workspace that survives multiple commands, SSH reconnects, MCP restarts, and network interruptions. Your working directory, environment variables, shell history, and running processes remain intact.

```
Traditional SSH MCP

AI
 └─ ssh exec channel
      └─ command
           └─ state lost every time


SSH Agent Workspace

AI
 └─ persistent tmux workspace
      ├─ cwd persists
      ├─ env persists
      ├─ shell history persists
      ├─ running processes persist
      └─ auto recovery
```

---

## Why This Exists

Most SSH MCP servers use exec channels. Every command starts from scratch:

```
❌ No persistent cwd — cd /var/www before every command
❌ No persistent env vars — re-export forever
❌ Interactive programs break — vim, htop, docker attach don't work
❌ State disappears after reconnect — start over from nothing
```

SSH Agent Workspace treats SSH as a **persistent workspace** instead of a command runner. Give your AI agent a real terminal that stays alive.

---

## Core Features

- **Stateful workspaces** — Persistent tmux-backed sessions. cwd, env, history survive everything.
- **Automatic recovery** — Reconnect to existing sessions after SSH drops or MCP restarts.
- **Runtime reconfiguration** — Enable/disable tools, update per-host security policies without restart.
- **Deterministic output** — Prompt sentinel-based execution. No sleep-based output guessing.

---

## Quick Start

### Install

```bash
npm install -g ssh-agent-workspace
```

Or from source:

```bash
git clone https://github.com/ShiroNexo/ssh-agent-workspace.git
cd ssh-agent-workspace
npm install && npm run build
```

### Setup Your SSH Config

Hosts must be defined in `~/.ssh/config`:

```
Host prod
  HostName 10.0.0.5
  User deploy
  IdentityFile ~/.ssh/id_ed25519

Host staging
  HostName 10.0.0.10
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

### Try It

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

<details>
<summary><b>Workspace (9 tools)</b></summary>

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
</details>

<details>
<summary><b>File Transfer (3 tools)</b></summary>

| Tool | Description |
|---|---|
| `sftp_upload` | Upload file to remote |
| `sftp_download` | Download file from remote |
| `sftp_list` | List remote directory |
</details>

<details>
<summary><b>Monitoring (3 tools)</b></summary>

| Tool | Description |
|---|---|
| `connection_status` | SSH liveness + tmux existence |
| `health_check` | CPU / RAM / Disk / Load / Uptime |
| `tail_log` | Log tail with optional follow |
</details>

<details>
<summary><b>DevOps (6 tools)</b></summary>

| Tool | Description |
|---|---|
| `deploy` | Upload → backup → chmod → chown → restart |
| `backup` | tar.gz archive → download → cleanup |
| `sync` | Rsync-lite via SFTP (bidirectional, dry-run) |
| `ssh_tunnel_open` | Local port forward or SOCKS5 proxy |
| `ssh_tunnel_list` | List active tunnels |
| `ssh_tunnel_close` | Close tunnel, free port |
</details>

<details>
<summary><b>Cluster & Queries (2 tools)</b></summary>

| Tool | Description |
|---|---|
| `group_exec` | Run command across multiple workspaces (parallel/sequential) |
| `db_query` | Read-only MySQL / PostgreSQL / MongoDB via SSH |
</details>

<details>
<summary><b>Runtime Config (2 tools)</b></summary>

| Tool | Description |
|---|---|
| `tools_config` | Enable/disable tools at runtime |
| `host_security` | Per-host read-only, command allow/denylist |
</details>

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
