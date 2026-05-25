# dynamic-ssh-mcp

Production-grade MCP (Model Context Protocol) server providing **persistent interactive SSH sessions** to multiple remote hosts. Built on **tmux** for true session persistence, stateful shell environments, and seamless AI-native workflows.

Unlike stateless `ssh host command` wrappers, this server maintains long-lived connections where **cwd, env variables, shell history, and running processes** survive disconnections and reconnections.

---

## Architecture

```
OpenCode / Claude Code
        |
        | MCP stdio
        v
dynamic-ssh-mcp (Node.js / TypeScript)
        |
        | SessionManager (in-memory registry)
        v
   SSH Connection Pool (ssh2)
        |
        | per-session SSH client
        v
   tmux session on remote host
        |
        v
   interactive bash / zsh
```

### Design Principles

1. **Persistent sessions** — tmux is the source of truth; processes survive SSH drops
2. **Multi-host support** — connect to any host defined in `~/.ssh/config`
3. **Multi-session support** — multiple independent sessions per host
4. **tmux-backed persistence** — every session is a tmux session
5. **Reconnect-safe** — reconnect to the same host without losing remote state
6. **AI-friendly tool design** — tools map to natural AI agent workflows
7. **Streaming-ready architecture** — capture-pane enables incremental reads
8. **Production-grade error handling** — structured errors, timeouts, cleanup
9. **Secure by default** — SSH config based auth, host allowlisting, command denylist
10. **SSH config based auth** — no passwords stored in MCP config

---

## Non-Goals

The following are explicitly **NOT** goals for V1:

- Full terminal emulation (ANSI/VT100 is out of scope)
- Interactive curses UI support (htop works but no cursor control)
- Vim/nano compatibility inside MCP tools
- SSH password authentication (keys and SSH agent only)
- Arbitrary hostname/IP access (aliases from `~/.ssh/config` only)
- Kubernetes/container orchestration
- Web UI or browser-based terminal
- Persistent database storage for sessions
- Multi-user authentication system

**Keep V1 focused on stable AI-native shell persistence.**

---

## Security Model

- **No passwords in MCP config** — authentication is delegated entirely to your existing `~/.ssh/config`, SSH keys, and SSH agent.
- **Host alias whitelist** — only aliases explicitly defined in `~/.ssh/config` can be used. Arbitrary IP addresses or hostnames are rejected.
- **Session isolation** — each session has its own SSH connection and tmux session.
- **Audit logging** — every tool call, connection, disconnection, and error is logged via structured logging (pino).
- **Read-only mode** — optional `MCP_SSH_READONLY=true` disables all input sending and command execution.
- **Command denylist** — optional `MCP_SSH_DENYLIST_COMMANDS` blocks dangerous command patterns.
- **Allowed host filter** — optional `MCP_SSH_ALLOWED_HOSTS` restricts which aliases can be used.
- **Sanitized session names** — tmux session names are sanitized to prevent injection.

---

## tmux Ownership Rule

The MCP server only manages tmux sessions it created itself.

Managed sessions MUST use the naming pattern:

```
mcp_<host>_<random>
```

The server must never create, modify, or kill unrelated tmux sessions belonging to the user or other processes.

---

## V1 tmux Constraint

V1 only supports:

- **single tmux session** per MCP session
- **single window**
- **single pane**

Do not implement pane splitting, multi-window workflows, or window management in V1. The architecture is designed to support these later, but the V1 toolset treats each session as exactly one shell in one pane.

---

## ANSI Sanitization

All output returned to the AI is stripped of ANSI escape sequences before transmission:

- Terminal color codes
- Cursor control sequences
- Text styling (bold, underline, etc.)
- Other escape sequences

This ensures clean, readable output for the AI and prevents garbled text from terminal applications.

---

## Output Windowing

`read_output` supports tail-based reads with configurable line windows:

```json
{
  "session_id": "sess_abc123...",
  "lines": 200
}
```

This captures the **last N lines** from the tmux pane. Future versions may add cursor/checkpoint-based incremental reads, but V1 uses simple tail windows.

---

## No Shell Interpolation

**SECURITY WARNING:** Never construct shell commands using naive string concatenation.

This server uses a safe base64-based pipeline to send input to tmux:

```bash
printf '%s' 'BASE64_PAYLOAD' | base64 -d | tmux load-buffer -
tmux paste-buffer -t 'SESSION_NAME' -d
```

All tmux and SSH arguments are passed as safely as possible. Do not implement:

```ts
exec(`tmux send-keys ${input}`)
```

This would be a command injection vulnerability.

---

## tmux Health Check

Before every operation, the server verifies that the tmux session still exists on the remote host. If the session has been deleted or is stale, the operation fails with a clear error so the AI can reconnect or create a new session.

---

## Shell Prompt Strategy

On connect, the server injects a deterministic shell prompt:

```bash
export PS1='__MCP_PROMPT__> '
```

This enables reliable **command completion detection** in the `exec` tool. The prompt is unique and easy to grep, so the server can heuristically determine when a command has finished executing and the shell has returned to an idle state.

**Supported shells:** bash, zsh. Other shells (fish, csh, tcsh) are not supported in V1.

---

## Prompt Stabilization

The `exec` tool does **not** merely sleep for a fixed duration. It implements prompt stabilization:

1. Send the command to the tmux pane
2. Wait a minimum grace period (`wait_ms`)
3. Poll `tmux capture-pane` periodically
4. Detect when the deterministic prompt `__MCP_PROMPT__> ` appears
5. Once the prompt is detected, the command is considered complete
6. Capture and return output

This avoids race conditions where the AI reads output before the command finishes.

---

## tmux Capture Strategy

All output reads use:

```bash
tmux capture-pane -p -S -LINES
```

Do **not** scrape interactive stdout streams directly in V1. tmux is the single source of truth for terminal contents. This approach is deterministic, race-free, and does not require complex PTY parsers.

---

## Session Recovery

If the MCP process restarts:

- Existing tmux sessions **survive** on the remote host
- The `reconnect_to_tmux` tool allows attaching to an old tmux session by name
- The architecture is designed so future session restore (auto-reconnect to previous sessions) can be added without refactoring the core model

---

## SSH Resilience

The server implements multiple layers of resilience:

- **TCP keepalive** — `keepaliveInterval: 10000`, `keepaliveCountMax: 3`
- **Connection timeout** — 20-second ready timeout
- **Stale connection detection** — SSH `error` and `close` events are monitored
- **Graceful recovery** — when an SSH connection drops, the session is cleaned up locally, but the remote tmux session persists
- **Automatic reconnect** — the AI can call `connect` or `reconnect_to_tmux` to resume work

---

## IMPORTANT

Do **NOT** implement command execution using:

```bash
ssh host "command"
```

All commands **MUST** execute inside the persistent tmux shell session via `tmux send-keys` and `tmux capture-pane`.

The remote shell session is the source of truth.

---

## Recommended Internal Flow

```text
connect()
  |
  +-- validate host alias against ~/.ssh/config
  |
  +-- open SSH connection (ssh2)
  |
  +-- ensure tmux is installed on remote host
  |
  +-- create or attach tmux session
  |
  +-- detect shell (bash/zsh only)
  |
  +-- inject deterministic PS1='__MCP_PROMPT__> '
  |
  +-- apply tmux options (history-limit=50000, mouse=off)
  |
  +-- register Session object in SessionManager
```

---

## Recommended tmux Options

On every new session, the server applies these tmux options:

```bash
tmux set-option -t <session> history-limit 50000
tmux set-option -t <session> mouse off
```

- **history-limit 50000** — Large scrollback buffer for AI context recovery. The AI can read thousands of lines of previous output.
- **mouse off** — Prevents mouse events from interfering with `send-keys` and `paste-buffer` operations.

---

## Streaming Architecture

Output handling is designed so future real-time streaming is possible **without** refactoring the core session model:

- Sessions are stable objects with an SSH client and tmux name
- Output is read from tmux, not from a raw stream
- Future streaming can poll `tmux capture-pane` on a timer or use tmux hooks
- The session manager and tool interface remain unchanged

---

## AI Operating Model

The AI should treat sessions as **persistent workspaces**, not disposable command runners.

**Preferred workflow:**

```text
connect once
  ↓
maintain shell state (cd, env, history)
  ↓
reuse the same session for multiple operations
  ↓
read output incrementally
  ↓
disconnect only when done
```

**Anti-pattern to avoid:**

```text
connect → exec → disconnect
connect → exec → disconnect
```

This destroys shell state and tmux sessions unnecessarily. The design goal is a persistent remote execution environment, not a stateless command executor.

---

# Prerequisites

You need:

* Node.js 18+ on your local machine
* SSH access to your remote server
* tmux installed on the remote server
* bash or zsh on the remote server

This MCP server works on:

* macOS
* Linux
* Windows
* WSL

---

# Step 1: Install Node.js

Install Node.js on the machine where OpenCode/Claude Code runs.

## macOS

Using Homebrew:

```bash
brew install node
```

---

## Ubuntu / Debian

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## Fedora / RHEL / CentOS

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

---

## Windows

### Recommended: WSL

Install WSL:

```powershell
wsl --install
```

Then open Ubuntu inside WSL and follow the Linux instructions above.

---

### Native Windows

Using winget:

```powershell
winget install OpenJS.NodeJS
```

Or download Node.js from:

```text
https://nodejs.org
```

---

## Verify

Run:

```bash
node --version
```

You should see Node.js 18 or higher.

---

# Step 2: Install tmux on the Remote Server

tmux must exist on every server you want the MCP to manage.

SSH into your server normally first.

Example:

```bash
ssh your_user@your_server
```

Then install tmux.

---

## Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install -y tmux
```

---

## Fedora / RHEL / CentOS

```bash
sudo dnf install -y tmux
```

---

## Arch Linux

```bash
sudo pacman -S tmux
```

---

## macOS Remote Host

```bash
brew install tmux
```

---

## Verify

Run:

```bash
tmux -V
```

You should see something like:

```text
tmux 3.4
```

---

# Step 3: Generate an SSH Key

If you already use SSH keys and can login without passwords, skip this section.

Run this on your LOCAL machine:

```bash
ssh-keygen -t ed25519 -C "mcp"
```

Press Enter for all questions.

This creates:

```text
~/.ssh/id_ed25519
```

(private key)

and:

```text
~/.ssh/id_ed25519.pub
```

(public key)

---

# Step 4: Copy Your SSH Key to the Server

## macOS / Linux / WSL

Run:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub your_user@your_server
```

Enter your password one last time.

Done.

---

## Windows CMD / PowerShell

Show your public key:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy the entire line.

Then SSH into the server:

```bash
ssh your_user@your_server
```

On the server:

```bash
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
```

Paste the key into the file.

Save:

* CTRL+O
* Enter
* CTRL+X

Then run:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Exit:

```bash
exit
```

---

# Step 5: Verify Passwordless SSH

Try logging in again:

```bash
ssh your_user@your_server
```

If it logs in WITHOUT asking for a password:
success 🎉

---

# Step 6: Create Your SSH Config

This lets you use aliases like:

```bash
ssh prod
```

instead of:

```bash
ssh ubuntu@203.0.113.10
```

---

## Linux / macOS / WSL

Edit:

```bash
~/.ssh/config
```

---

## Windows Native

Edit:

```text
C:\Users\YOUR_NAME\.ssh\config
```

Important:

* filename must be exactly `config`
* NOT `config.txt`

---

## Example Config

```ssh
Host prod
    HostName 203.0.113.10
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519

Host gpu
    HostName 203.0.113.20
    User root
    IdentityFile ~/.ssh/id_ed25519
```

---

# Step 7: Test Your SSH Alias

Run:

```bash
ssh prod
```

If it logs in successfully without asking for a password:
everything is ready.

---

# Quick Checklist

Before starting the MCP server:

* Node.js installed
* tmux installed on remote host
* SSH key generated
* SSH key copied to server
* SSH config created
* `ssh prod` works without password

---

# Install the MCP Project

## Clone the Repository

```bash
git clone https://github.com/yourusername/dynamic-ssh-mcp.git
cd dynamic-ssh-mcp
```

---

## Install Dependencies

```bash
npm install
```

---

## Build

```bash
npm run build
```

---

## Verify

Run:

```bash
node dist/index.js
```

You should see:

```text
Dynamic SSH MCP server running on stdio
```

Press:

```text
CTRL+C
```

to stop.

---

# OpenCode Integration

Add the MCP server:

```bash
opencode mcp add ssh
```

Command:

```text
node /absolute/path/to/dynamic-ssh-mcp/dist/index.js
```

---

# Final Test

Inside OpenCode:

```text
list SSH hosts
```

Then:

```text
connect to prod
```

If the AI connects successfully:
your setup is complete 🎉

---

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (`trace`, `debug`, `info`, `warn`, `error`) | `info` |
| `MCP_SSH_READONLY` | Disable input sending and command execution | `true` |
| `MCP_SSH_ALLOWED_HOSTS` | Comma-separated allowed host aliases (empty = all) | `prod,staging` |
| `MCP_SSH_DENYLIST_COMMANDS` | Comma-separated command substrings to block | `rm -rf,shutdown,halt` |

---

## OpenCode Integration

### Option 1: CLI

```bash
opencode mcp add ssh --command "node /absolute/path/to/dynamic-ssh-mcp/dist/index.js"
```

### Option 2: Config File

Add to your OpenCode MCP configuration:

```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["/absolute/path/to/dynamic-ssh-mcp/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Option 3: Claude Code / Other MCP Clients

Use the same command/args structure in your client's MCP settings.

---

## MCP Tools

### `list_hosts`

Returns all available SSH aliases from `~/.ssh/config`.

**Input:** none

**Output:**
```json
{
  "hosts": ["prod", "gpu", "staging"]
}
```

---

### `connect`

Connects to a host and creates a persistent tmux-backed session. Automatically detects the shell and injects a deterministic prompt.

**Input:**
```json
{
  "host": "prod"
}
```

**Output:**
```json
{
  "session_id": "sess_abc123...",
  "host": "prod",
  "tmux_session": "mcp_prod_abc123",
  "shell": "bash"
}
```

**Internal flow:**
```
validate host alias
  ↓
open SSH connection
  ↓
ensure tmux exists
  ↓
create/attach tmux session
  ↓
detect shell (bash/zsh)
  ↓
inject PS1='__MCP_PROMPT__> '
  ↓
register Session
```

---

### `reconnect_to_tmux`

Reconnect to an existing tmux session on a remote host. Useful for recovery after MCP restarts or SSH disconnections.

**Input:**
```json
{
  "host": "prod",
  "tmux_session": "mcp_prod_abc123"
}
```

**Output:**
```json
{
  "session_id": "sess_def456...",
  "host": "prod",
  "tmux_session": "mcp_prod_abc123"
}
```

---

### `send_input`

Sends raw input into the tmux pane. Preserves shell state. Non-blocking.

**Input:**
```json
{
  "session_id": "sess_abc123...",
  "input": "cd /var/www && ls -la\n"
}
```

---

### `read_output`

Captures the latest terminal output from the tmux pane.

**Input:**
```json
{
  "session_id": "sess_abc123...",
  "lines": 200
}
```

---

### `interrupt`

Sends an interrupt signal (Ctrl-C) or termination signal (Ctrl-D) to the active process in a tmux session.

**Input:**
```json
{
  "session_id": "sess_abc123...",
  "signal": "SIGINT"
}
```

**Use cases:**
- Stop a long-running command that is taking too long
- Cancel a build or deployment
- Break out of an infinite loop

---

### `exec`

High-level helper: sends a command, waits for prompt stabilization, and captures output.

**Input:**
```json
{
  "session_id": "sess_abc123...",
  "command": "npm run build",
  "wait_ms": 200,
  "max_wait_ms": 15000,
  "lines": 500
}
```

**Behavior:**
1. Send the command with a newline
2. Wait minimum `wait_ms`
3. Poll `tmux capture-pane` until the deterministic prompt `__MCP_PROMPT__> ` appears
4. If prompt not detected within `max_wait_ms`, return current output
5. Return captured output (prompts stripped)

This avoids race conditions and gives reliable output for both fast and slow commands.

---

### `disconnect`

Disconnects from a session. Optionally kills the remote tmux session.

**Input:**
```json
{
  "session_id": "sess_abc123...",
  "preserve_tmux": true
}
```

---

### `list_sessions`

Lists all active MCP sessions.

**Output:**
```json
{
  "sessions": [
    {
      "id": "sess_abc123...",
      "host": "prod",
      "connectedAt": 1715420000000,
      "lastActivity": 1715420100000,
      "tmuxSession": "mcp_prod_abc123"
    }
  ]
}
```

---

## Example Workflows

### Workflow 1: Deploy to Production

```
AI: list_hosts
   → ["prod", "staging", "gpu"]

AI: connect host=prod
   → session_id: sess_xxx

AI: exec session=sess_xxx command="cd /opt/app && git pull"
   → output: Already up to date.

AI: exec session=sess_xxx command="npm ci && npm run build" max_wait_ms=30000
   → output: build success...

AI: exec session=sess_xxx command="pm2 restart app"
   → output: [PM2] Restarting app...

AI: read_output session=sess_xxx lines=50
   → output: App restarted successfully

AI: disconnect session=sess_xxx preserve_tmux=true
```

### Workflow 2: Long-Running Training Job on GPU

```
AI: connect host=gpu
   → session_id: sess_gpu1

AI: send_input session=sess_gpu1 input="cd ~/experiments/run-7\n"

AI: send_input session=sess_gpu1 input="python train.py --epochs 100\n"
   → (command running in background)

AI: read_output session=sess_gpu1 lines=100
   → Epoch 12/100 | loss: 0.234...

(5 minutes later)

AI: read_output session=sess_gpu1 lines=100
   → Epoch 67/100 | loss: 0.089...

(SSH drops and reconnects)

AI: reconnect_to_tmux host=gpu tmux_session=mcp_gpu_abc123
   → session_id: sess_gpu2 (reconnected to existing tmux)
```

### Workflow 3: Multi-Host Monitoring

```
AI: connect host=prod → sess_1
AI: connect host=staging → sess_2
AI: connect host=gpu → sess_3

AI: exec session=sess_1 command="df -h" wait_ms=500
AI: exec session=sess_2 command="docker ps" wait_ms=500
AI: exec session=sess_3 command="nvidia-smi" wait_ms=500
```

---

## Troubleshooting

### Installation Issues

#### "node: command not found"

**macOS:** `brew install node`
**Ubuntu/Debian:** `sudo apt-get install nodejs`
**Windows:** Download from [nodejs.org](https://nodejs.org) or use `winget install OpenJS.NodeJS`

#### "npm: command not found"

Node.js usually includes npm. If missing:
**Ubuntu/Debian:** `sudo apt-get install npm`

#### "Cannot find module" errors after `npm install`

Try deleting `node_modules` and reinstalling:
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
npm run build
```

---

### SSH & Connection Issues

#### "tmux is not installed on host"

Install tmux on the remote host. See [Step 2: Install tmux on Remote Hosts](#step-2-install-tmux-on-remote-hosts).

#### "Host alias 'X' not found in SSH config"

Ensure the alias exists in `~/.ssh/config` and is not a wildcard pattern (`*`).

**Check your config:**
```bash
cat ~/.ssh/config
```

#### SSH connection timeout or auth failure

1. **Verify your SSH key exists:**
   ```bash
   ls -la ~/.ssh/id_ed25519
   ```

2. **Test passwordless login manually:**
   ```bash
   ssh <alias>
   ```
   If it asks for a password, your key is not set up correctly. See [Step 3: Set Up SSH Keys](#step-3-set-up-ssh-keys).

3. **Check SSH agent has your key:**
   ```bash
   ssh-add -l
   ```
   If empty or error, add your key:
   ```bash
   ssh-add ~/.ssh/id_ed25519
   ```

4. **Verify SSH config paths:**
   - macOS/Linux: `~/.ssh/config`
   - Windows (WSL): `~/.ssh/config` (inside WSL)
   - Windows (Native): `C:\Users\<YourName>\.ssh\config`

5. **Check key permissions (macOS/Linux):**
   ```bash
   chmod 700 ~/.ssh
   chmod 600 ~/.ssh/id_ed25519
   chmod 644 ~/.ssh/id_ed25519.pub
   ```

#### "Permission denied (publickey)"

This means the remote host rejected your key. Common causes:
- Key not copied to remote host: Run `ssh-copy-id` again
- Wrong user in SSH config: Check `User` field
- SSH agent not running: Start with `eval "$(ssh-agent -s)"`

---

### Session Issues

#### Session not found or disconnected

The SSH connection may have dropped. The tmux session is still running on the remote host. Simply call `connect` again to create a new session, or use `reconnect_to_tmux` to attach to an existing tmux session.

#### "Tmux health check failed: session missing"

The tmux session was killed on the remote host (possibly by the user or system). Create a new session with `connect`.

#### Output seems truncated or stale

Increase the `lines` parameter in `read_output` or `exec`, or call `read_output` again after a delay.

---

### Shell & Environment Issues

#### Shell is not bash or zsh

V1 only supports bash and zsh. Other shells (fish, csh, tcsh) do not support the deterministic `PS1` strategy reliably. Change the remote user's login shell to bash or zsh:

```bash
# On the remote host
chsh -s /bin/bash
# or
chsh -s /bin/zsh
```

#### "Failed to inject deterministic prompt"

This usually means the shell is not bash/zsh, or the shell is not ready yet. The server will continue without the prompt, but `exec` may not detect command completion reliably. Try increasing `wait_ms` in `exec`.

---

### Platform-Specific Issues

#### Windows (Native) - Path Issues

If using native Windows (not WSL), you may encounter path issues:
- Use double backslashes or forward slashes in paths
- Ensure your SSH config uses Windows-compatible paths
- Consider using WSL for the best experience

#### Windows (WSL) - "Cannot open shared object file"

This usually means Node.js is installed on Windows but not inside WSL. Install Node.js inside WSL:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### macOS - "Operation not permitted"

If you get permission errors on macOS:
1. Go to **System Preferences > Security & Privacy > Privacy**
2. Add Terminal (or your IDE) to **Full Disk Access**
3. Restart your terminal

---

### General Tips

#### Check Server Logs

Run with debug logging to see detailed information:
```bash
LOG_LEVEL=debug node dist/index.js
```

#### Verify MCP Connection

If OpenCode/Claude Code doesn't recognize the tool:
1. Check the MCP server path is correct in config
2. Verify `node dist/index.js` runs without errors
3. Check the client logs for MCP connection errors

#### Full Reset

If everything is broken:
```bash
# Disconnect all sessions
# Then:
rm -rf node_modules dist
npm install
npm run build
```

---

## Project Structure

```
src/
  index.ts              # Entry point
  server.ts             # MCP server setup
  types/
    index.ts            # Shared TypeScript types
  core/
    SessionManager.ts   # Session lifecycle registry
    SSHManager.ts       # SSH connection management
    TmuxManager.ts      # tmux operations over SSH
  tools/
    index.ts            # Tool exports
    list_hosts.ts
    connect.ts
    reconnect_to_tmux.ts
    send_input.ts
    read_output.ts
    exec.ts
    interrupt.ts
    disconnect.ts
    list_sessions.ts
  utils/
    sshConfig.ts        # ~/.ssh/config parser
    logger.ts           # Structured logging (pino)
    validation.ts       # Input sanitization
    security.ts         # Security policy checks
    ansi.ts             # ANSI escape sequence stripping
```

---

## Future Roadmap

- **Streaming output** — real-time pane output streaming via SSE or MCP sampling
- **SFTP upload/download** — file transfer tools
- **Port forwarding** — dynamic/local/remote port forwarding
- **Sudo workflows** — handling password prompts securely
- **Command completion** — shell completion support
- **tmux multi-window / pane management** — window creation and pane splits
- **Terminal emulation** — proper ANSI/VT100 emulation for rich output
- **AI memory per host** — host-specific context and preferences
- **Session restore** — automatic reconnect to previous tmux sessions on startup
- **Remote agent deployment** — deploy helper scripts to remote hosts
- **Persistent storage** — SQLite/Redis backend for session metadata

---

## License

MIT
