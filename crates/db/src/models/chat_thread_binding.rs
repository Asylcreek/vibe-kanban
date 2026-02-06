use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ChatThreadBindingError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatThreadBinding {
    pub thread_id: Uuid,
    pub session_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpsertChatThreadBinding {
    pub thread_id: Uuid,
    pub session_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
}

impl ChatThreadBinding {
    pub async fn find_by_thread_id(
        pool: &SqlitePool,
        thread_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatThreadBinding>(
            r#"SELECT thread_id,
                      session_id,
                      workspace_id,
                      created_at,
                      updated_at
               FROM chat_thread_bindings
               WHERE thread_id = $1"#,
        )
        .bind(thread_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn upsert(
        pool: &SqlitePool,
        payload: &UpsertChatThreadBinding,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatThreadBinding>(
            r#"INSERT INTO chat_thread_bindings (thread_id, session_id, workspace_id)
               VALUES ($1, $2, $3)
               ON CONFLICT(thread_id) DO UPDATE SET
                 session_id = excluded.session_id,
                 workspace_id = excluded.workspace_id,
                 updated_at = datetime('now', 'subsec')
               RETURNING thread_id,
                         session_id,
                         workspace_id,
                         created_at,
                         updated_at"#,
        )
        .bind(payload.thread_id)
        .bind(payload.session_id)
        .bind(payload.workspace_id)
        .fetch_one(pool)
        .await
    }

    pub async fn delete_by_thread_id(
        pool: &SqlitePool,
        thread_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM chat_thread_bindings WHERE thread_id = $1")
            .bind(thread_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
