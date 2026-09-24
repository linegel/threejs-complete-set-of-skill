# Temporary artifacts

| Path | Purpose | Removable when | Status |
| --- | --- | --- | --- |
| artifacts/website-improvement-20260924/ | Existing image verification, screenshots, and recoverable obsolete variants | Retain measurements referenced in PROGRESS.md; archive policy decided separately | Pre-existing, preserved |
| artifacts/website-improvement-20260924/continuation/ | Current focused logs and isolated browser MCP output | Retain accepted screenshots and reports cited by PROGRESS.md | Retained verification records |
| artifacts/website-improvement-20260924/continuation/tmp/ | Process-owned temporary files, including MCP and build staging | All owned processes have exited and verification is recorded | Removed, 6,621,675,111 bytes |

All paths are inside this repository and covered by the existing artifacts/ ignore.
Untracked historical capture staging and bisect files belong to earlier work and
are not claimed by this cleanup record.

| artifacts/pw-sockets/ | Short Unix-socket path for isolated browser MCP; the longer continuation path exceeds the OS socket limit | MCP closes | Removed |

The earlier static site server and MCP transport owned by Node REPL PID 63490 have exited.
The earlier input-less Node PID 62188 was stopped without running browser work.

| .playwright-mcp/ | Browser MCP snapshot and console output | Browser inspection is recorded and MCP closes | Removed |
| artifacts/website-improvement-20260924/continuation/mcp-session.mjs | Thin MCP transport with durable command/response files; no browser-driver implementation | Browser inspection ends | Removed |
| artifacts/website-improvement-20260924/continuation/commands/ | Exact MCP requests and responses for this inspection | Retain exact accepted observations alongside screenshots | Retained verification records |

PID 63490 and its port have exited; its terminal session is no longer available.
The replacement transport used the same isolated launcher and recorded its
worker identity. It closed the browser and server before scratch cleanup.

Detached replacement MCP transport worker PID 88788 exited at 2026-09-24T04:31:15Z.
Port 4173 is released; .playwright-mcp and artifacts/pw-sockets are absent.
