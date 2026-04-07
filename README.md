# agent-tool-interceptor

> A runtime CLI layer that intercepts AI agent tool calls and enforces execution boundaries.

**Project:** #25 | **License:** MIT | **Status:** MVP in progress

## What It Does

`agent-tool-interceptor` sits between any AI agent (Claude Code, Codex, Cursor, custom scripts) and its tool executions, intercepting every tool call before it runs:

- **Policy engine** — Define rules in `interceptor.yaml` to allow, block, log, or require approval
- **Hard-no patterns** — Built-in protection against ~10 most dangerous commands (`rm -rf /`, fork bombs, etc.)
- **Trace log** — Every tool call logged to `interceptor-trace.jsonl`
- **Report** — Generate human-readable Markdown summaries

## Quick Start

```bash
# Install globally
npm install -g agent-tool-interceptor

# Run a command with interception
agent-tool-interceptor run -- npx jest

# Blocked example
agent-tool-interceptor run -- bash -c "rm -rf /"
# → ❌ BLOCKED: bash - Destructive root command

# Generate report
agent-tool-interceptor report
```

## Policy Configuration

Create `interceptor.yaml` in your project:

```yaml
rules:
  - match: tool == "bash" && args.command contains "rm -rf"
    action: block
    reason: "Destructive shell command"
  - match: tool == "bash"
    action: log
```

Actions: `allow` (default) | `log` | `require_approval` | `block`

## CLI Options

| Flag | Description |
|------|-------------|
| `--` | Separator: everything after is the wrapped command |
| `--policy, -p` | Path to interceptor.yaml (default: ./interceptor.yaml) |
| `--trace, -t` | Path to trace log (default: ./interceptor-trace.jsonl) |
| `--agent, -a` | Agent name (default: unknown) |
| `--report, -r` | Generate report from trace |
| `--help, -h` | Show help |

## Trace Format

```json
{"ts":"2026-03-31T04:22:00Z","agent":"claude-code","tool":"bash","args":{"command":"pip install requests"},"policy":"allow","durationMs":1240,"exitCode":0}
```

## Hard-No Patterns

The following patterns are blocked by default:

- `rm -rf /`, `rm -rf ~`
- `sudo rm ...`
- Fork bombs (`:(){:|:&};:`)
- `curl | sh`, `wget | sh`
- Writing to `/etc/`, `/usr/`, `~/.ssh/`, `~/.aws/`

## Report Command

```bash
agent-tool-interceptor report
# → Markdown summary of all tool calls
```

## GitHub Action

```yaml
- uses: anuragg-saxenaa/agent-tool-interceptor@v1
  with:
    policy: ./interceptor.yaml
```

## Development

```bash
npm install
npm run build
npm test
```

## Status

- [x] CLI wrapper mode
- [x] Policy loading (YAML)
- [x] Hard-no patterns
- [x] Trace logging (JSONL)
- [x] Report command
- [ ] Replay functionality
- [ ] MCP proxy mode
- [ ] Approval gate UI
- [ ] 
