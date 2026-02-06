# /new-ui Project Threads + CLI Chat Spec

## Goal
- Build `/new-ui` as a direct chat UI for local coding CLIs.
- Keep existing backend strengths (executor process management, logs, approvals, retries).
- Remove task/workspace concepts from `/new-ui` user experience.

## Confirmed Product Decisions
- `/new-ui` must not expose tasks.
- Threads are grouped by project.
- Each project has exactly one repo.
- Concurrency is allowed, including multiple active threads in the same project/repo.
- Worktree isolation is opt-in (not default).

## Current Backend Constraints (Must Be Respected)
- Current execution contract is `session -> workspace -> execution_process`.
- `sessions.create` requires `workspace_id`.
- `sessions.follow-up` always loads workspace and ensures container/worktree exists.
- Workspace creation requires a `task_id` and repos in current API.
- Current `/new-ui` page is a showcase route and incorrectly assumes a pre-existing workspace.

## Target Behavior for `/new-ui`
1. User selects a project and creates threads under that project.
2. Sending a message executes against the project repo by default (no worktree isolation).
3. Per-thread opt-in toggle enables isolated mode (existing workspace/worktree pipeline).
4. User never sees "create workspace first" errors on `/new-ui`.

## Proposed Architecture

### New Thread Domain (UI-facing)
- Introduce a `/new-ui` thread model independent from tasks in UX:
  - `project_id`
  - `thread_id`
  - `title`
  - `execution_mode`: `in_place | isolated`
  - `created_at`, `updated_at`

### Execution Context Binding (Backend-facing)
- Each thread stores execution binding:
  - `session_id` (active backend session used by thread)
  - `workspace_id` nullable:
    - `null` for `in_place`
    - set for `isolated`

### New Execution Mode
- Add `in_place` execution mode in backend container/execution layer:
  - Resolve working directory directly to project repo path.
  - Skip worktree/workspace creation and branch generation.
  - Reuse existing executor spawn, approvals, streaming, and process persistence.

### Isolated Mode
- Reuse existing workspace pipeline as-is:
  - create/resolve workspace
  - create session
  - follow-up through existing endpoints

## API Proposal (High Level)
- `GET /api/new-ui/projects/:project_id/threads`
- `POST /api/new-ui/projects/:project_id/threads`
- `PATCH /api/new-ui/threads/:thread_id` (title/mode)
- `POST /api/new-ui/threads/:thread_id/messages` (send/execute)
- `GET /api/new-ui/threads/:thread_id/processes/stream/ws` (or map to existing process streams)

Implementation detail:
- For `in_place`, use new backend service path, not `sessions.follow-up` directly, because that route hard-requires workspace semantics.

## Data Model Proposal
- New table `chat_threads`.
- New table `chat_thread_messages` (optional if frontend keeps local-only display, but recommended for persistence).
- New table `chat_thread_bindings`:
  - `thread_id`
  - `session_id` nullable
  - `workspace_id` nullable
  - invariant: `workspace_id IS NULL` iff mode is `in_place`.

## Migration / Compatibility
- No changes required to existing tasks/workspaces pages.
- Existing task/workspace schema and APIs remain intact.
- `/new-ui` becomes its own product surface backed by the new thread domain.

## Risks
- Concurrent in-place runs can conflict at filesystem/git level (accepted by product decision).
- Some executor assumptions may currently depend on workspace env vars.
- Log normalization should continue to work when execution directory is repo root.

## Non-Goals (for initial delivery)
- Multi-repo per project support in `/new-ui`.
- Replacing workspaces UI.
- Removing task/workspace backend models.

## Acceptance Criteria
- User can open `/new-ui`, choose a project, create thread, send message, and get streaming response without creating task/workspace manually.
- Thread mode defaults to `in_place`.
- User can switch thread to `isolated` and execute through existing worktree path.
- No `/new-ui` message send path emits workspace-not-found guidance.
