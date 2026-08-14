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

3. **Launch the `pr-reviewer` sub-agent asynchronously** — pass `cwd` if a worktree was detected. Direct execution (`subagent({ agent, task, ... })`) was removed in current pi — all child launches go through a `workflowScript` with `runs.run`:

```javascript
const cwdArg = toplevel ? `, cwd: '${toplevel}'` : ''
const run = subagent({
  workflowScript: `return runs.run('main', { agent: 'pr-reviewer', task: 'PR #<number> on <owner/repo>', context: 'fresh'${cwdArg} })`,
  async: true
})
// run.id holds the async run ID — keep it for later
```

If no worktree was detected (`toplevel` empty), the sub-agent is launched without `cwd` and will prompt the user (diff-only or clone) when needed.

4. **Do not wait or block.** The agent will report back asynchronously when its review is ready. Continue responding to the user in the meantime. Note the run ID — if the agent completes before a decision is made, you can resume it.

5. **If the agent contacts you for approval** via `contact_supervisor`, do NOT just relay the agent's summary and ask for a decision. The user wants to read the actual report — not a file path, not a tl;dr. Instead:
   1. Read the report file at `$XDG_RUNTIME_DIR/pr-review/<owner>/<repo>/<number>/report.md`
   2. **Write the full report contents as your actual response text.** This means copying the Markdown directly into what you say to the user. Do NOT summarize it. Do NOT just read it into a tool output block and then describe what it says. The `read` tool shows the file to *you*, not to the user — your job is to then output that content as your own response. Literally write out every line of the report as part of your reply, so the user can read it inline.
   3. After presenting the report, ask: "Post it? Revise something? Don't post?"
   4. Reply to the agent with the user's decision

6. **Offer to escalate outstanding findings to GitHub issues** — after the review decision is made, if the report contains unresolved 🟡/🟢 findings, propose turning them into GitHub issues **assigned to the PR author** so they don't get lost. Group only what shares a subsystem or fix class; keep self-contained fixes as their own issue. Reference the PR and the finding in each body. Check `gh issue list` for duplicates first, present the proposed list, and wait for an explicit yes — never create issues unprompted. Skip documentation-only items and anything another issue already tracks.

   **Link the created issues from the PR** so anyone viewing the PR later can navigate to the outstanding work:
   - Every issue body must reference the PR in the exact form `PR #<number>` — that backlink is how issues are discovered later (`gh issue list --repo <owner>/<repo> --state open --search '"PR #<number>"'`).
   - After the issues are created, post a PR comment linking them. Review bodies are immutable — GitHub has no API to edit a submitted review — so the links always go in a comment:
     ```bash
     gh pr comment <number> --repo <owner>/<repo> --body "Outstanding follow-ups from the review: #<n> #<n> …"
     ```
   - Verify the comment is visible on the PR before moving on.

7. **If the agent's `contact_supervisor` times out** (~1–2 min), the agent exits gracefully but leaves the report file on disk. You have two options:

   **Option A — Resume the agent (preserves full context):**
   ```javascript
   subagent({ action: "resume", id: "<run-id>", message: "Post the review, please." })
   ```
   The agent revives with all its previous session intact — it still has the reviewer outputs, oracle analysis, and the report it wrote. You can ask for revisions, request more detail, or give it a final decision.

   **Option B — Post manually (file only, no agent context):**
   1. Find the report file at: `$XDG_RUNTIME_DIR/pr-review/<owner>/<repo>/<number>/report.md` (or `/run/user/1000/pr-review/...`)
   2. Verify the file exists
   3. Post it — determine the review state from the report first:
      ```bash
      REPORT_PATH="/run/user/1000/pr-review/<owner>/<repo>/<number>/report.md"
      if grep -q '🟢 \*\*APPROVE\*\*' "$REPORT_PATH"; then
        gh pr review <number> --repo <owner/repo> --approve --body-file "$REPORT_PATH"
      else
        gh pr review <number> --repo <owner/repo> --request-changes --body-file "$REPORT_PATH"
      fi
      ```
   4. Report back that it was posted

8. **When the user says "post the review of PR #<number>" and you have the run ID:**
   - Resume the agent: `subagent({ action: "resume", id: "<run-id>", message: "Post the review now, please." })`
   - If resume fails (session expired), fall back to the file path (Option B above)

9. **When the user says "clean up review <number>":**
   **⚠️ Only perform cleanup when the PR has been merged or closed.** If the user asks to clean up while the PR is still open, remind them that the report and worktree are still active reference material and suggest waiting until the PR reaches a terminal state.
   - Run `rm -rf ${XDG_RUNTIME_DIR}/pr-review/<owner>/<repo>/<number>/`
   - If it was a git worktree, also remove it: `cd <repo> && git worktree remove /run/user/1000/pr-review/...` and delete the temp branch

10. **Follow-up questions** — if the agent can be resumed, the user can ask about the codebase or request report changes. If it can't, the report file is still there for reference.

11. **Review post-mortem (optional)** — when the user says "run the review post-mortem" (or "post-mortem"), produce the standard metrics analysis: for each sub-agent run (pr-reviewer plus any reviewer/oracle children) report duration, tool-call mix (`serena_*` vs `bash` vs `read`/`grep`/`find`), turns, tokens (input/output/cache-read) and cost where available, with diff-size context, and compare against previous rounds. Attribute differences honestly (diff size vs serena vs test infrastructure). Note: serena availability is machine-dependent — a run with no serena calls is not a defect and must never be flagged as one; the review flow is identical with or without it.

The `pr-reviewer` agent handles the review itself. You manage the lifecycle: capture the run ID at launch, use `resume` for follow-ups, and fall back to the file only if needed.
