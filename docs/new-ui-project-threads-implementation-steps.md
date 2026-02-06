# /new-ui Project Threads Implementation Steps

## How to Use This File
- Execute phases in order.
- Commit after each phase.
- If paused, resume from first unchecked item.

## Phase 0: Alignment + Guardrails
- [x] Confirm this scope stays limited to `/new-ui`.
- [x] Confirm default thread mode is `in_place`.
- [x] Confirm concurrent execution remains enabled.
- [x] Confirm each project has exactly one repo (validate in code path).

## Phase 1: Data Layer
- [x] Add migrations for `chat_threads` and `chat_thread_bindings`.
- [x] Add DB models in `crates/db/src/models/` for new tables.
- [x] Add model methods: create/list/update thread, get/save bindings.
- [x] Add TS exports via type generator and run `pnpm run generate-types`.

Deliverable:
- Persistent project-scoped threads with execution-mode metadata.

## Phase 2: Backend Thread APIs
- [x] Add new `/api/new-ui/...` routes in `crates/server/src/routes/`.
- [x] Implement list/create/update thread endpoints.
- [x] Implement send-message endpoint that dispatches by `execution_mode`.
- [x] Add stream endpoint or map existing process stream by returned process id.
- [x] Register router in `routes/mod.rs`.

Deliverable:
- New API surface for `/new-ui` thread CRUD + send.

## Phase 3: In-Place Execution Mode
- [x] Add execution path that runs in project repo root without worktree creation.
- [x] Reuse existing executor spawn, approvals, logging, and process persistence.
- [x] Ensure env vars remain populated (project/thread/session/process context).
- [ ] Ensure no workspace-dependent code path is required for in-place mode.
- [ ] Add tests for in-place send lifecycle.

Deliverable:
- Backend can run coding agents directly in project repo path.

## Phase 4: Isolated Mode Integration
- [x] Reuse existing workspace creation + session flow for isolated threads.
- [x] Persist resulting `workspace_id`/`session_id` in thread binding.
- [x] Ensure thread-level mode switching updates routing behavior.
- [ ] Add tests covering both modes.

Deliverable:
- Thread mode toggle correctly selects in-place vs isolated execution.

## Decision Notes
- [x] Shared workspace is created at project creation time and reused by all `in_place` threads.
- [x] `isolated` threads provision and bind a dedicated workspace.
- [x] Switching thread mode is disallowed; users should create a new thread for a different mode.

## Phase 5: `/new-ui` Frontend Refactor
- [x] Replace workspace bootstrap logic in `Ui6ChatbotPage`.
- [x] Add project-scoped thread list sourced from new APIs.
- [x] Add thread create/select UX.
- [x] Add thread mode toggle (default `in_place`).
- [x] Wire send to new `/api/new-ui/threads/:id/messages`.
- [x] Keep agent/profile selectors.
- [x] Remove workspace-not-found messaging from `/new-ui`.

Deliverable:
- `/new-ui` operates via project threads and can execute immediately.

## Phase 6: Streaming + Message Persistence
- [ ] Persist user/assistant messages per thread.
- [ ] Ensure stream reconnect behavior for active runs.
- [ ] Render process completion and failures without linking to workspaces by default.

Deliverable:
- Stable thread history and resilient stream UX.

## Phase 7: Hardening + QA
- [ ] Backend unit/integration tests for new routes and execution branching.
- [ ] Frontend checks: `pnpm run check` and `pnpm run lint`.
- [ ] Manual QA:
- [ ] create thread in project, send message in-place.
- [ ] run two threads concurrently in same project.
- [ ] switch one thread to isolated and send again.
- [ ] verify no task/workspace setup prompt appears in `/new-ui`.

Deliverable:
- Verified behavior matches product decisions.

## Phase 8: Documentation
- [ ] Update `/docs` with `/new-ui` behavior and execution modes.
- [ ] Keep `AGENTS.md` architecture notes in sync.

Deliverable:
- Future agents can continue implementation without rediscovery.
