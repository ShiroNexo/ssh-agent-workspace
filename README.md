# dynamic-ssh-mcp

Production-grade MCP server for **persistent interactive SSH sessions** via tmux. Sessions survive disconnections, MCP restarts, and SSH drops — **cwd, env, history, and running processes** are preserved.

```text
OpenCode / Claude Code
        │
        │ MCP stdio
        ▼
dynamic-ssh-mcp (Node.js)
        │
        │ ssh2 per session
        ▼
tmux session on remote host (bash/zsh)
```

---

## Quick Start

### Prerequisites

- **Local:** Node.js ≥18
- **Remote:** tmux installed, bash or zsh shell
- **SSH:** key-based auth, alias in `~/.ssh/config`

### Install

```bash
git clone https://github.com/ShiroNexo/dynamic-ssh-mcp.git
cd dynamic-ssh-mcp
npm install
npm run build
```

### Configure MCP Client

**OpenCode CLI:**
```bash
opencode mcp add ssh --command "node /path/to/dynamic-ssh-mcp/dist/index.js"
```

**Config file (`opencode.json`):**
```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["/path/to/dynamic-ssh-mcp/dist/index.js"],
      "env": { "LOG_LEVEL": "info" }
    }
  }
}
```

### Verify

Start a chat and type: `connect to prod` — if it connects successfully, you're done.

---

## MCP Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_hosts` | List SSH aliases from `~/.ssh/config` | — |
| `connect` | Create persistent tmux-backed session | `host` |
| `reconnect_to_tmux` | Reattach to existing tmux session | `host`, `tmux_session` |
| `exec` | Send command, wait for prompt, return output | `session_id`, `command`, `wait_ms`, `max_wait_ms`, `lines` |
| `send_input` | Send raw input (non-blocking) | `session_id`, `input` |
| `read_output` | Capture tail of terminal pane | `session_id`, `lines` |
| `interrupt` | Send Ctrl-C to foreground process | `session_id`, `signal` |
| `disconnect` | Close session, optionally kill tmux | `session_id`, `preserve_tmux` |
| `list_sessions` | List active sessions | — |

### `exec` — Prompt Stabilization

The `exec` tool sends a command and polls `tmux capture-pane` until the deterministic prompt `__MCP_PROMPT__> ` appears — no fixed sleep, no race conditions.

```
Send command → wait_ms grace → poll every 250ms → detect prompt → capture output
```

---

## Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `MCP_SSH_READONLY` | `false` | Block all input/exec (set `true`) |
| `MCP_SSH_ALLOWED_HOSTS` | (all) | Comma-separated aliases: `prod,staging` |
| `MCP_SSH_DENYLIST_COMMANDS` | (none) | Block patterns: `rm -rf,shutdown` |
| `MCP_SSH_RESTORE_SESSIONS` | `true` | Auto-restore `mcp_*` tmux sessions on startup |

---

## How It Works

### Session Lifecycle

```
connect()
  ├─ validate host alias in ~/.ssh/config
  ├─ open SSH connection (ssh2, key-based, 20s ready timeout)
  ├─ verify tmux is installed
  ├─ create tmux session: mcp_<host>_<random>
  ├─ detect shell (bash/zsh only — others rejected)
  ├─ inject PS1='__MCP_PROMPT__> ' (with retry + verification)
  ├─ apply options: history-limit=50000, mouse=off
  └─ register in SessionManager + persist to ~/.dynamic-ssh-mcp/
```

### Security

- **No passwords stored** — auth via SSH keys/agent + `~/.ssh/config`
- **Host whitelist** — only aliases from SSH config; arbitrary IPs rejected
- **Command denylist** — blocks dangerous patterns (substring match, case-insensitive)
- **Read-only mode** — `MCP_SSH_READONLY=true` blocks all write operations
- **Shell injection protection** — all tmux arguments shell-escaped; input sent via base64 buffer pipeline
- **Session isolation** — each session = own SSH connection + own tmux session

### Session Persistence

- Session metadata saved to `~/.dynamic-ssh-mcp/sessions.json`
- On restart, server scans all hosts for `mcp_*` tmux sessions and reconnects
- Disable with `MCP_SSH_RESTORE_SESSIONS=false`
- Old tmux sessions survive server crashes indefinitely

### SSH Resilience

- TCP keepalive every 10s (3 max attempts)
- 20s ready timeout on connect
- 30s command execution timeout
- `close`/`error` events clean up local session; remote tmux persists

---

## Project Structure

```
src/
├── index.ts              # Entry point + session restore
├── server.ts             # MCP server setup, tool routing
├── types/index.ts        # TypeScript types
├── core/
│   ├── SessionManager.ts # In-memory session registry + storage sync
│   ├── SSHManager.ts     # SSH connection management (ssh2)
│   ├── TmuxManager.ts    # tmux operations over SSH
│   └── StorageManager.ts # Persistent session metadata (JSON file)
├── tools/
│   ├── connect.ts, disconnect.ts, exec.ts
│   ├── interrupt.ts, list_hosts.ts, list_sessions.ts
│   ├── read_output.ts, reconnect_to_tmux.ts, send_input.ts
│   └── index.ts
└── utils/
    ├── ansi.ts           # ANSI escape stripping
    ├── logger.ts         # Structured logging (pino → stderr)
    ├── security.ts       # Read-only, allowlist, denylist checks
    ├── sshConfig.ts      # ~/.ssh/config parser
    └── validation.ts     # Input sanitization
```

---

## Troubleshooting

### No SSH hosts listed
Check `~/.ssh/config` exists and has `Host` entries (no wildcards).

### Connection timeout / auth failure
```bash
ssh-add -l                    # Check agent has key
ssh <alias>                   # Test manual login
chmod 600 ~/.ssh/id_*         # Fix key permissions
```

### Unsupported shell
Only bash and zsh are supported. Change login shell on remote host:
```bash
chsh -s /bin/bash
```

### Fresh start
```bash
rm -rf node_modules dist package-lock.json
npm install && npm run build
```

---

## Future Roadmap

- SFTP file transfer tools
- Port forwarding (dynamic/local/remote)
- Sudo/password prompt handling
- Multi-pane / multi-window tmux
- Terminal emulation with ANSI/VT100
- AI memory per host
- Remote agent deployment

---

## License

MIT
