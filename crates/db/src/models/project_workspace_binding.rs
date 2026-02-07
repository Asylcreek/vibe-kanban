use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ProjectWorkspaceBinding {
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

impl ProjectWorkspaceBinding {
    pub async fn find_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ProjectWorkspaceBinding>(
            r#"SELECT project_id,
                      workspace_id,
                      created_at,
                      updated_at
               FROM project_workspace_bindings
               WHERE project_id = $1"#,
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn upsert(
        pool: &SqlitePool,
        project_id: Uuid,
        workspace_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ProjectWorkspaceBinding>(
            r#"INSERT INTO project_workspace_bindings (project_id, workspace_id)
               VALUES ($1, $2)
               ON CONFLICT(project_id) DO UPDATE SET
                 workspace_id = excluded.workspace_id,
                 updated_at = datetime('now', 'subsec')
               RETURNING project_id,
                         workspace_id,
                         created_at,
                         updated_at"#,
        )
        .bind(project_id)
        .bind(workspace_id)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ProjectWorkspaceBinding>(
            r#"SELECT project_id,
                      workspace_id,
                      created_at,
                      updated_at
               FROM project_workspace_bindings
               WHERE workspace_id = $1"#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }
}
