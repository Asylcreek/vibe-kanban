CREATE TABLE chat_threads (
    id              BLOB PRIMARY KEY,
    project_id      BLOB NOT NULL,
    title           TEXT NOT NULL,
    execution_mode  TEXT NOT NULL
                    CHECK (execution_mode IN ('in_place', 'isolated')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_threads_project_id ON chat_threads(project_id);
CREATE INDEX idx_chat_threads_project_updated_at ON chat_threads(project_id, updated_at DESC);

CREATE TABLE chat_thread_bindings (
    thread_id        BLOB PRIMARY KEY,
    session_id       BLOB,
    workspace_id     BLOB,
    created_at       TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX idx_chat_thread_bindings_session_id ON chat_thread_bindings(session_id);
CREATE INDEX idx_chat_thread_bindings_workspace_id ON chat_thread_bindings(workspace_id);
