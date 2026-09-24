# Temporary artifacts

| Path | Purpose | Removable when | Status |
| --- | --- | --- | --- |
| artifacts/website-improvement-20260924/ | Existing image verification, screenshots, and recoverable obsolete variants | Retain measurements referenced in PROGRESS.md; archive policy decided separately | Pre-existing, preserved |
| artifacts/website-improvement-20260924/continuation/ | Current focused logs and isolated browser MCP output | Current findings are summarized in PROGRESS.md and changes are committed | Planned |
| artifacts/website-improvement-20260924/continuation/tmp/ | Process-owned temporary files, including MCP and build staging | All owned processes have exited and verification is recorded | Planned |

All paths are inside this repository and covered by the existing artifacts/ ignore.
Untracked historical capture staging and bisect files belong to earlier work and
are not claimed by this cleanup record.

| artifacts/pw-sockets/ | Short Unix-socket path for isolated browser MCP; the longer continuation path exceeds the OS socket limit | MCP closes | Active |

The static site server and MCP transport are owned by Node REPL PID 63490.
The earlier input-less Node PID 62188 was stopped without running browser work.

| .playwright-mcp/ | Browser MCP snapshot and console output | Browser inspection is recorded and MCP closes | Active, ignored |
| artifacts/website-improvement-20260924/continuation/mcp-session.mjs | Thin MCP transport with durable command/response files; no browser-driver implementation | Browser inspection ends | Active |
| artifacts/website-improvement-20260924/continuation/commands/ | Exact MCP requests and responses for this inspection | Relevant findings are recorded | Active |

PID 63490 and its port have exited; its terminal session is no longer available.
The replacement transport is detached from transient terminal sessions and uses
the same isolated launcher. It records its own and its MCP child PIDs on startup.

Detached replacement MCP transport worker: PID 88788.
