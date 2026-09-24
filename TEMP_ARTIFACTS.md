# Temporary artifacts

| Path | Purpose | Removable when | Status |
| --- | --- | --- | --- |
| artifacts/website-improvement-20260924/ | Existing image verification, screenshots, and recoverable obsolete variants | Retain measurements referenced in PROGRESS.md; archive policy decided separately | Pre-existing, preserved |
| artifacts/website-improvement-20260924/continuation/ | Current focused logs and isolated browser MCP output | Current findings are summarized in PROGRESS.md and changes are committed | Planned |
| artifacts/website-improvement-20260924/continuation/tmp/ | Process-owned temporary files, including MCP and build staging | All owned processes have exited and verification is recorded | Planned |

All paths are inside this repository and covered by the existing artifacts/ ignore.
Untracked historical capture staging and bisect files belong to earlier work and
are not claimed by this cleanup record.
