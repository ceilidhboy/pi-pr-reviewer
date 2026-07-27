---
name: pr-review
description: Review a GitHub pull request by creating a temporary worktree, running reviewer + oracle sub-agents, and asking for approval before posting. Use when user says "review PR #N", "review pull request", "review this PR", provides a PR URL, or asks for a PR review.
---

# PR Review

When asked to review a GitHub pull request:

1. **Parse the request** — extract the PR number and optional owner/repo from:
   - `PR #44` (repo inferred from git remote)
   - `PR #44 on owner/repo`
   - `https://github.com/owner/repo/pull/44`
   - `owner/repo#44`

2. **Detect the current directory** — before launching the sub-agent, check whether the current working directory is a git worktree. This lets the sub-agent start in the right place:

```bash
TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null)" || TOPLEVEL=""
if [ -n "$TOPLEVEL" ]; then
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  CURRENT_REMOTE="$(git remote get-url origin 2>/dev/null)"
fi
```

If `TOPLEVEL` is set, record it to use as the sub-agent's working directory. This ensures the sub-agent's built-in `git rev-parse` discovery logic runs against the actual worktree.

3. **Launch the `pr-reviewer` sub-agent asynchronously** — pass `cwd` if a worktree was detected:

```javascript
const launchConfig = {
  agent: "pr-reviewer",
  task: "PR #<number> on <owner/repo>",
  context: "fresh",
  async: true
}
if (toplevel) {
  launchConfig.cwd = toplevel
}
const run = subagent(launchConfig)
// run.id holds the async run ID — keep it for later
```

If no worktree was detected, the sub-agent is launched without `cwd` and will prompt the user (diff-only or clone) when needed.

4. **Do not wait or block.** The agent will report back asynchronously when its review is ready. Continue responding to the user in the meantime. Note the run ID — if the agent completes before a decision is made, you can resume it.

5. **If the agent contacts you for approval** via `contact_supervisor`, reply quickly with one of:
   - `Post it` — the agent posts the review as a PR comment
   - `Revise X` — the agent revises the report and presents again (using its full context from reviewer + oracle)
   - `Don't post` — the agent stops without posting

6. **If the agent's `contact_supervisor` times out** (~1–2 min), the agent exits gracefully but leaves the report file on disk. You have two options:

   **Option A — Resume the agent (preserves full context):**
   ```javascript
   subagent({ action: "resume", id: "<run-id>", message: "Post the review, please." })
   ```
   The agent revives with all its previous session intact — it still has the reviewer outputs, oracle analysis, and the report it wrote. You can ask for revisions, request more detail, or give it a final decision.

   **Option B — Post manually (file only, no agent context):**
   1. Find the report file at: `$XDG_RUNTIME_DIR/pr-review/<owner>/<repo>/<number>/report.md` (or `/run/user/1000/pr-review/...`)
   2. Verify the file exists
   3. Post it: `gh pr review <number> --repo <owner/repo> --comment --body-file "<path>"`
   4. Report back that it was posted

7. **When the user says "post the review of PR #<number>" and you have the run ID:**
   - Resume the agent: `subagent({ action: "resume", id: "<run-id>", message: "Post the review now, please." })`
   - If resume fails (session expired), fall back to the file path (Option B above)

8. **When the user says "clean up review <number>":**
   - Run `rm -rf ${XDG_RUNTIME_DIR}/pr-review/<owner>/<repo>/<number>/`
   - If it was a git worktree, also remove it: `cd <repo> && git worktree remove /run/user/1000/pr-review/...` and delete the temp branch

9. **Follow-up questions** — if the agent can be resumed, the user can ask about the codebase or request report changes. If it can't, the report file is still there for reference.

The `pr-reviewer` agent handles the review itself. You manage the lifecycle: capture the run ID at launch, use `resume` for follow-ups, and fall back to the file only if needed.
