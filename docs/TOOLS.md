# Tool Reference

Complete reference for all 25 MCP tools.

---

## Session Management

### `list_hosts`

List all SSH host aliases from `~/.ssh/config`. Wildcard entries are ignored.

| Parameter | Type | Required |
|---|---|---|
| _(none)_ | — | — |

**Returns:** Array of host alias strings.

---

### `connect`

Connect to a remote host via SSH and create a persistent tmux-backed shell session. Supports bash and zsh only. Session survives MCP restarts and SSH drops.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `host` | string | **Yes** | SSH config host alias |
| `proxy_jump` | string | No | Bastion host alias for proxy jump |

**Returns:** `{ session_id, host, tmux_session, shell }`

---

### `reconnect_to_tmux`

Reconnect to an existing tmux session on a remote host. Use after MCP restart or SSH disconnection to recover a session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `host` | string | **Yes** | SSH config host alias |
| `tmux_session` | string | **Yes** | Tmux session name (e.g., `mcp_prod_abc12345`) |
| `proxy_jump` | string | No | Bastion host alias |

**Returns:** `{ session_id, host, tmux_session }`

---

### `exec`

Execute a command in a tmux session with prompt stabilization. Sends the command, waits for the deterministic PS1 prompt to appear, then captures output.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID from connect |
| `command` | string | **Yes** | Shell command to execute |
| `wait_ms` | number | No | Min wait before prompt detection (default: 200, max: 60000) |
| `max_wait_ms` | number | No | Max total wait for prompt (default: 10000, max: 300000) |
| `lines` | number | No | Max output lines to return (default: 200, max: 5000) |

**Returns:** `{ output, command }`

**Blocked when:** Read-only mode, per-host read-only, command in denylist.

---

### `send_input`

Send raw input into a tmux session. Preserves shell state (cwd, env, history). Non-blocking — no prompt wait.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `input` | string | **Yes** | Raw input text |

**Blocked when:** Read-only mode, per-host read-only.

---

### `read_output`

Capture recent terminal output from a tmux session pane.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `lines` | number | No | Number of lines to capture (default: 50) |

**Always allowed** (read-only operation).

---

### `interrupt`

Send an interrupt or termination signal to the active process in a tmux session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `signal` | string | No | `SIGINT` (Ctrl-C, default) or `SIGTERM` (Ctrl-D) |

**Always allowed.**

---

### `disconnect`

Close a session. Optionally kills the remote tmux session or leaves it running for later reconnection.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `preserve_tmux` | boolean | No | Keep tmux session alive on remote (default: false) |

**Always allowed.**

---

### `list_sessions`

List all active MCP SSH sessions with host, connection time, last activity, and tmux session name.

| Parameter | Type | Required |
|---|---|---|
| _(none)_ | — | — |

**Returns:** Array of `{ id, host, tmuxSession, connectedAt, lastActivity, shell }`.

---

## File Transfer

### `sftp_upload`

Upload a local file to a remote host via SFTP.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `local_path` | string | **Yes** | Absolute local file path |
| `remote_path` | string | **Yes** | Absolute remote destination path |

**Blocked when:** Read-only mode, per-host read-only.

---

### `sftp_download`

Download a file from a remote host via SFTP.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `remote_path` | string | **Yes** | Absolute remote file path |
| `local_path` | string | **Yes** | Absolute local destination path |

**Blocked when:** Read-only mode, per-host read-only.

---

### `sftp_list`

List files and directories on a remote host via SFTP.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `path` | string | No | Remote path (default: home directory) |

**Always allowed** (read-only operation). Returns file/directory listing with name, size, permissions, mtime.

---

## Health & Monitoring

### `connection_status`

Check the health of an active session: SSH connection liveness and tmux session existence.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |

**Returns:** `{ alive: boolean, tmux_exists: boolean, tmux_session: string }`

**Always allowed.**

---

### `health_check`

Run a system health check via SSH exec channel (non-interactive — does not touch the tmux session). Returns structured system metrics.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |

**Returns:**
```json
{
  "host": "prod",
  "cpu": { "model": "Intel...", "cores": 8, "usage": 23.5 },
  "memory": { "total": "16G", "used": "8.2G", "usage": 51.2 },
  "disk": [{ "mount": "/", "total": "100G", "used": "45G", "usage": 45 }],
  "load": { "1m": 0.5, "5m": 0.8, "15m": 1.1 },
  "uptime": "5 days 3 hours"
}
```

**Always allowed.**

---

### `tail_log`

Read the last N lines of a remote log file via SSH exec channel. Optionally follow (poll) for new output.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `file_path` | string | **Yes** | Absolute remote file path |
| `lines` | number | No | Lines to read (default: 50, max: 5000) |
| `follow_ms` | number | No | Follow duration in ms (max: 30000) |

**Always allowed.** Follow mode polls every 500ms and returns new lines.

---

## DevOps

### `deploy`

Deploy files to a remote host. Full pipeline per file:

```
pre_deploy_cmd → backup (.bak) → upload → chmod → chown → post_deploy_cmd → restart_service
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `files` | array | **Yes** | `[{ local, remote }]` — file mappings |
| `chmod` | string | No | Permission mode (e.g., `"755"`) |
| `chown` | string | No | Owner:group (e.g., `"www-data:www-data"`) |
| `backup` | boolean | No | Create .bak before overwrite (default: true) |
| `restart_service` | string | No | Service name to restart via systemctl |
| `pre_deploy_cmd` | string | No | Command to run before deployment |
| `post_deploy_cmd` | string | No | Command to run after deployment |

**Returns:** Per-file result with status and any errors. Errors are isolated per file — one failure doesn't stop others.

**Blocked when:** Read-only mode, per-host read-only.

---

### `backup`

Create a compressed tar.gz archive of remote paths and download it locally.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `paths` | array | **Yes** | Remote paths to backup (e.g., `["/etc/nginx", "/var/log"]`) |
| `local_dest` | string | **Yes** | Local directory for the downloaded archive |
| `exclude` | array | No | Path patterns to exclude |
| `remove_remote_archive` | boolean | No | Clean up archive on remote after download (default: true) |

**Returns:** `{ archive, size, local_path, files_backup }`

**Blocked when:** Read-only mode, per-host read-only.

---

### `sync`

Bidirectional rsync-like sync between local and remote directories via SFTP. Compares files by mtime and size, transfers only changed or new files.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `local_path` | string | **Yes** | Absolute local directory path |
| `remote_path` | string | **Yes** | Absolute remote directory path |
| `direction` | string | No | `"upload"`, `"download"`, or `"bidirectional"` (default) |
| `dry_run` | boolean | No | Preview changes without applying (default: false) |
| `max_depth` | number | No | Max recursion depth (default: 10) |

**Returns:** `{ files_uploaded, files_downloaded, skipped, errors }`

**Blocked when:** Read-only mode, per-host read-only.

---

## SSH Tunnels

### `ssh_tunnel_open`

Open an SSH tunnel (local port forwarding or SOCKS5 proxy). Creates a dedicated SSH connection separate from the session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `type` | string | **Yes** | `"local"` or `"socks5"` |
| `local_port` | number | **Yes** | Local port to bind |
| `remote_host` | string | **Yes** | Remote target host |
| `remote_port` | number | **Yes** | Remote target port |

**Returns:** `{ tunnel_id, type, local_port, remote_host, remote_port }`

**SOCKS5:** Implements no-auth CONNECT protocol. Sufficient for AI agent use.

**Blocked when:** Read-only mode, per-host read-only.

---

### `ssh_tunnel_list`

List all active SSH tunnels.

| Parameter | Type | Required |
|---|---|---|
| _(none)_ | — | — |

**Returns:** Array of `{ tunnel_id, type, local_port, remote_host, remote_port }`.

**Always allowed.**

---

### `ssh_tunnel_close`

Close and clean up an active SSH tunnel. Frees the local port and disconnects the dedicated SSH connection.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tunnel_id` | string | **Yes** | Tunnel ID from `ssh_tunnel_open` |

**Always allowed.**

---

## Multi-Session & Database

### `group_exec`

Execute the same command across multiple tmux sessions simultaneously (parallel) or one-by-one (sequential). Each session runs independently with its own prompt stabilization.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_ids` | array | **Yes** | Up to 20 session IDs |
| `command` | string | **Yes** | Shell command to execute |
| `wait_ms` | number | No | Min wait before prompt detection (default: 200) |
| `max_wait_ms` | number | No | Max total wait (default: 10000) |
| `lines` | number | No | Max output lines per session (default: 200) |
| `parallel` | boolean | No | Run all at once (default: true) |

**Returns:** Array of `{ session_id, host, status, output, error? }`.

**Blocked when:** Read-only mode (per-session check — read-only hosts are skipped with error).

---

### `db_query`

Execute a read-only database query on a remote host via SSH exec channel. Supports MySQL, PostgreSQL, and MongoDB. Returns structured JSON rows.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | **Yes** | Session ID |
| `type` | string | **Yes** | `"mysql"`, `"postgres"`, or `"mongodb"` |
| `database` | string | **Yes** | Database name |
| `query` | string | **Yes** | SQL query or Mongo find query (JSON string) |
| `db_user` | string | No | Database user (falls back to session user) |
| `db_password` | string | No | Database password |
| `db_host` | string | No | Database host (default: localhost) |
| `db_port` | number | No | Database port (default: MySQL 3306, PG 5432, Mongo 27017) |
| `collection` | string | No | MongoDB collection name |
| `timeout_ms` | number | No | Query timeout (default: 30000, max: 120000) |

**Returns:** Array of JSON row objects.

**SQL enforcement:** Only `SELECT`, `SHOW`, `EXPLAIN`, `DESCRIBE`, and `WITH` queries allowed. All mutation keywords rejected.

**MongoDB enforcement:** Only `find`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`, `listCollections` allowed.

**Blocked when:** Read-only mode, per-host read-only.

---

## Security Management

### `tools_config`

Manage tool enable/disable state. Disable unused tools to reduce token overhead in the MCP tool list. Config persists at `~/.dynamic-ssh-mcp/tools.json`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | **Yes** | `"list"`, `"enable"`, `"disable"`, `"reset"` |
| `tool` | string | Conditional | Tool name (required for enable/disable) |

**Self-protection:** `tools_config` cannot be disabled — it always remains enabled.

**Always allowed.**

---

### `host_security`

Manage per-host security settings: read-only mode, command allowlist, and command denylist. Settings persist at `~/.dynamic-ssh-mcp/host_security.json` and override global `MCP_SSH_READONLY` per host.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | **Yes** | `"get"`, `"set"`, `"remove"` |
| `host` | string | Conditional | Host alias (required for set/remove) |
| `readonly` | boolean | No | Force read-only for this host (set only) |
| `allow_commands` | array | No | Command allowlist patterns (set only) |
| `deny_commands` | array | No | Command denylist patterns (set only) |

**Examples:**
```
host_security action=get host=prod
host_security action=set host=prod readonly=true
host_security action=set host=staging deny_commands=["shutdown", "reboot"]
host_security action=remove host=prod
```

**Always allowed.**
