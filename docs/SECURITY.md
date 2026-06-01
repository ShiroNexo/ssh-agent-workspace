# Security Model

`dynamic-ssh-mcp` implements a **three-layer defense** architecture. Each layer adds granularity without breaking the layers above it.

---

## Layer 1: Global (Environment Variables)

Set at server startup via environment variables. Applies to **all hosts**.

| Variable | Effect |
|---|---|
| `MCP_SSH_READONLY=true` | Blocks all write operations globally |
| `MCP_SSH_ALLOWED_HOSTS=prod,staging` | Only these host aliases can be connected to |
| `MCP_SSH_DENYLIST_COMMANDS=rm,shutdown,dd` | Blocks commands containing these substrings (case-insensitive) |

### Read-Only Mode: Blocked Tools

When `MCP_SSH_READONLY=true`, the following tools return errors:

- `exec` — Command execution disabled
- `send_input` — Input sending disabled
- `sftp_upload` — SFTP upload disabled
- `sftp_download` — SFTP download disabled
- `deploy` — Deploy disabled
- `backup` — Backup disabled
- `sync` — Sync disabled
- `group_exec` — Group exec disabled
- `db_query` — DB query disabled
- `ssh_tunnel_open` — Tunnels disabled

### Tools Always Allowed (Read Operations)

`list_hosts`, `connect`, `reconnect_to_tmux`, `read_output`, `interrupt`, `disconnect`, `list_sessions`, `sftp_list`, `connection_status`, `health_check`, `tail_log`, `ssh_tunnel_close`, `ssh_tunnel_list`, `tools_config`, `host_security`

---

## Layer 2: Per-Host (Host Security)

Managed via the `host_security` tool and persisted in `~/.dynamic-ssh-mcp/host_security.json`.

Per-host settings **override** global settings for that specific host only.

### Configuration

```json
{
  "prod": {
    "readonly": true,
    "deny_commands": ["shutdown", "reboot", "dd if="]
  },
  "staging": {
    "deny_commands": ["rm -rf /", "shutdown"]
  },
  "dev": {
    "allow_commands": [
      "ls", "cat", "echo", "ps aux",
      "docker ps", "docker logs",
      "git status", "git diff", "git log",
      "npm run", "node"
    ]
  }
}
```

### Rules

| Field | Behavior |
|---|---|
| `readonly: true` | Host locked to read-only, regardless of global `MCP_SSH_READONLY` |
| `readonly: false` | Host explicitly writeable (does **not** override global readonly) |
| `allow_commands: [...]` | If set, **only** commands matching these patterns are allowed (case-insensitive substring match) |
| `deny_commands: [...]` | Commands matching these patterns are blocked (case-insensitive substring match) |

**Precedence:** `deny_commands` wins over `allow_commands`. If a command matches both, it's blocked.

### Enforcement Points

Per-host read-only is checked **after session lookup** in every write tool:

```
exec, send_input, sftp_upload, sftp_download,
deploy, backup, sync, group_exec, db_query, ssh_tunnel_open
```

If a session's host has `readonly: true`, the tool returns:

```
Error: Host 'prod' is in read-only mode. <operation> is disabled.
```

### Per-Host Command Filtering

`isHostCommandDenied(host, command)` checks:
1. Global `MCP_SSH_DENYLIST_COMMANDS`
2. Per-host `allow_commands` (if set, command must match at least one)
3. Per-host `deny_commands`

Per-host command filtering is available to all tools via the shared security utility.

---

## Layer 3: Per-Operation (Tool-Level)

### Path Sanitization

All file paths used in SFTP, backup, deploy, sync, and tail_log are validated:

- Rejects paths containing `;`, `&&`, `||`, `|`
- Rejects paths starting with `-` (option injection)
- Paths are shell-escaped before passing to exec commands

### Command Denylist (Global)

Commands containing these substrings are blocked (case-insensitive):

```
rm -rf, shutdown, reboot, dd, mkfs, fdisk, :(){ :|:& };:  (fork bomb)
```

Configured via `MCP_SSH_DENYLIST_COMMANDS` — comma-separated:
```
MCP_SSH_DENYLIST_COMMANDS=rm -rf,shutdown,dd if=,mkfs,chmod 777
```

### SQL/MongoDB Query Security

The `db_query` tool enforces read-only queries:

**SQL (MySQL/PostgreSQL):**
- Blocked keywords: `DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `REVOKE`, `RENAME`, `REPLACE`, `MERGE`, `UPSERT`, `LOAD`
- Only allowed prefixes: `SELECT`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `WITH`

**MongoDB:**
- Blocked methods: `deleteOne`, `deleteMany`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `drop`, `dropDatabase`, `createIndex`, `createCollection`

### Shell Injection Protection

All arguments passed to tmux commands are:
1. Validated via Zod schemas before use
2. Passed through `sanitizeTmuxSessionName()` for session names
3. Base64-encoded buffer pipeline for command input (not raw string interpolation)
4. Escaped via `escapeShellArg()` for exec channel commands

### SFTP Security

- `sftp_upload` / `sftp_download`: paths validated before transfer
- `sftp_list`: read-only, allowed even in read-only mode
- `deploy`: validates all paths in the files array, plus exec commands for chmod/chown/restart

---

## Proxy Jump / Bastion Security

- Both the bastion host AND the target host must pass `isHostAllowed()` checks
- Bastion resolved from `~/.ssh/config` (`ProxyJump` directive) or explicit `proxy_jump` parameter
- Each hop uses its own SSH key from the corresponding `Host` config block
- The bastion connection is established first, then `forwardOut` is used to reach the target

---

## Session Isolation

- Each session = **one dedicated SSH connection** + **one dedicated tmux session**
- Sessions cannot see each other's tmux panes
- Session metadata stored locally at `~/.dynamic-ssh-mcp/sessions.json`
- No passwords are stored — auth is key-based via `~/.ssh/config`
- SSH key passphrases not stored; use `ssh-agent` for passphrase-protected keys

---

## Hardening Recommendations

### Production

```bash
# Global read-only on production
export MCP_SSH_READONLY=true

# Only prod and staging hosts
export MCP_SSH_ALLOWED_HOSTS=prod,staging

# Block dangerous operations
export MCP_SSH_DENYLIST_COMMANDS=rm\ -rf,shutdown,reboot,dd,chmod\ 777,>\
/dev/sd

# Only restore known sessions (don't discover new ones)
export MCP_SSH_RESTORE_SESSIONS=true
```

### Per-Host Fine-Tuning (via tools_config / host_security)

```
# Lock production to read-only
host_security set host=prod readonly=true

# Limit dev commands
host_security set host=dev deny_commands=["rm -rf", "shutdown", "reboot"]

# Disable unused tools to reduce attack surface
tools_config disable db_query
tools_config disable backup
tools_config disable sync
tools_config disable deploy
```

---

## Audit & Monitoring

- All tool invocations logged to stderr via pino (configurable `LOG_LEVEL`)
- Session create/remove/restore events logged with session IDs
- Failed connections, auth rejections, and denied commands logged at `warn` level
- Log format: structured JSON with timestamps
