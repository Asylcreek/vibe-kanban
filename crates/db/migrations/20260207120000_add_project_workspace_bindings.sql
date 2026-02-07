CREATE TABLE IF NOT EXISTS project_workspace_bindings (
    project_id   BLOB PRIMARY KEY,
    workspace_id BLOB NOT NULL UNIQUE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_workspace_bindings_workspace_id
    ON project_workspace_bindings(workspace_id);
