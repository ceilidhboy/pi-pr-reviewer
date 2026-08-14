# pi-pr-reviewer

Automated pull request reviews for [Pi](https://pi.dev). Delegates to reviewer and oracle sub-agents, consolidates their findings into a single structured report, and asks for your approval before posting.

## What's included

| Resource | Description |
|---|---|
| `pr-review` skill | Tells the main Pi agent how to launch the `pr-reviewer` sub-agent when you ask to review a PR |
| `pr-reviewer` agent | The engine — gathers PR context, runs parallel reviews, consolidates, sanitises, and presents the report for approval |
| `install-agent` extension | Symlinks the `pr-reviewer` agent into Pi automatically on install and update |

## Prerequisites

- [Pi](https://pi.dev) installed
- `gh` authenticated (`gh auth status`)
- Access to the repo whose PRs you want to review

## Installation

```bash
pi install git:github.com/ceilidhboy/pi-pr-reviewer.git
```

Then run `/reload` in Pi (or restart Pi).

The extension automatically installs the `pr-reviewer` agent into `~/.pi/agent/agents/` — nothing else to configure.

## Usage

From within any git repo whose remote matches the target PR's repo, say:

```
review PR #44
```

Or from anywhere, give the full URL:

```
review https://github.com/owner/repo/pull/44
```

Pi will launch the `pr-reviewer` agent asynchronously — your conversation stays responsive. The agent will:

1. Detect whether the current directory is already on the PR branch (and use it directly if so)
2. Otherwise, create a temporary worktree in `$XDG_RUNTIME_DIR/pr-review/` for full codebase access
3. Delegate to reviewer (adversarial code review) and oracle (decision-consistency check) sub-agents in parallel
4. Consolidate their findings into a single structured report
5. Write the report to a file alongside the worktree
6. Present the report for your approval via `contact_supervisor`

The agent never posts anything to the PR without your say-so.

### During a review

| What you say | What happens |
|---|---|
| `Post it` | Agent posts the report as a PR review comment |
| `Revise X` | Agent revises the report and presents again |
| `Don't post` | Agent stops without posting |
| *take too long to reply* | Agent exits gracefully — report file stays on disk. Resume with `subagent({ action: "resume", id: "<run-id>", message: "..." })` |

### Follow-up questions

The agent's full session context (reviewer outputs, oracle analysis, consolidated report) persists until the agent completes. If the agent has timed out, you can resume it via its run ID. Otherwise, the report file and worktree stay in `$XDG_RUNTIME_DIR/pr-review/` for reference. Clean up with:

```
clean up review 44
```

## Optional: Serena-powered code navigation

The review agents use [pi-serena](https://github.com/bacnh85/pi-extensions/tree/main/pi-serena) semantic tools (`serena_*`) for codebase analysis when available — faster symbol/reference navigation and LSP diagnostics than raw grep.

**Serena is strictly optional and never required.** On machines without the pi-serena package, the agents simply fall back to `grep`/`read`; the review flow, report format, and quality are identical. The shipped agent allowlists deliberately exclude serena tool names so the package works on every machine.

To enable serena on your machine (per-machine, local settings only):

1. Add `"npm:@bacnh85/pi-serena"` to the `packages` array in `~/.pi/agent/settings.json`.
2. Extend the tool allowlists of the three review agents via `subagents.agentOverrides` — e.g.:

```json
"subagents": {
  "agentOverrides": {
    "reviewer": {
      "tools": ["read", "grep", "find", "ls", "intercom", "serena_status", "serena_get_symbols_overview", "serena_find_symbol", "serena_find_referencing_symbols", "serena_search_for_pattern", "serena_get_diagnostics_for_file"]
    }
  }
}
```

Repeat the same `tools` override for `oracle` (base: `read, grep, find, ls, bash, intercom`) and `pr-reviewer` (base: `read, bash, subagent, subagent_wait, write`) if you want serena in the orchestrator too.
3. Reload Pi.

> Do NOT add serena tool names or absolute extension paths to the shipped agent files in this package — that would break launches on machines without pi-serena (strict allowlists hard-fail on unregistered tool names, and missing extension paths hard-fail the session).

## Updating

```bash
pi update --extensions
```

Then run `/reload` in Pi. The extension will re-symlink the agent files on the next session start.

## How it works

```
You ask to review a PR
        │
        ▼
  pr-reviewer agent (async, your conversation stays responsive)
        │
        ├── Gather PR context (gh pr view, gh pr diff)
        ├── Create temp worktree (or use current checkout)
        ├── Launch reviewer (fresh context) — code standards + spec check
        ├── Launch oracle (forked context) — patterns, auth, risks
        ├── Consolidate both reports
        ├── Sanitise (remove process references)
        ├── Write report to file
        └── contact_supervisor → present for approval
                                  │
                   ┌──────────────┼──────────────┐
                   ▼              ▼              ▼
                "Post it"    "Revise X"    "Don't post"
```

## Related packages

- [pi-agent-workflows](https://github.com/ceilidhboy/pi-agent-workflows) — Pi skills for orchestrating sub-agents and delegation patterns (includes `orchestrator-mode`)
