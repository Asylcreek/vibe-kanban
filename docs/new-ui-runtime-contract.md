# /new-ui Runtime Contract (Reset)

## Product Model
- `Project` is the top-level unit.
- `Thread` belongs to one `Project`.
- `/new-ui` message send must not require workspace input from the client.

## Execution Model
- Default mode is `in_place`.
- `in_place` runs directly in the project repo (no worktree creation).
- `isolated` is opt-in and may use worktree/workspace orchestration.

## Backend Contract
- `/api/new-ui/...` routes own thread CRUD and send.
- For `in_place` threads:
  - Reuse a project-shared internal workspace record only as backend plumbing.
  - Ensure `container_ref` points to the real project root parent (so `repo.name` resolves to repo path).
  - Do not call worktree provisioning (`ensure_container_exists`) in send flow.
  - Do not trigger worktree recreation during log normalization/replay.
- For `isolated` threads:
  - Keep existing workspace/worktree behavior.

## Safety Rules
- Never treat the main repository working tree as a disposable worktree.
- Never route `in_place` through worktree ensure/recreate paths.
- Worktree cleanup/recreate behavior is only valid for isolated workspaces.

## Non-Goals
- Rewriting legacy task/workspace architecture globally.
- Removing existing worktree code from the codebase.

## Rationale
- Keep backend compatibility with existing execution/session/process models.
- Preserve optional isolation for later.
- Make `/new-ui` reliably chat-first for project threads.
