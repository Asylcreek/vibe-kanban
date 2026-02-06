use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ChatThreadError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Chat thread not found")]
    NotFound,
}

#[derive(
    Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display, Default,
)]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ChatThreadExecutionMode {
    #[default]
    InPlace,
    Isolated,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatThread {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub execution_mode: ChatThreadExecutionMode,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateChatThread {
    pub project_id: Uuid,
    pub title: String,
    pub execution_mode: ChatThreadExecutionMode,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateChatThread {
    pub title: Option<String>,
    pub execution_mode: Option<ChatThreadExecutionMode>,
}

impl ChatThread {
    pub async fn find_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatThread>(
            r#"SELECT id,
                      project_id,
                      title,
                      execution_mode,
                      created_at,
                      updated_at
               FROM chat_threads
               WHERE project_id = $1
               ORDER BY updated_at DESC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatThread>(
            r#"SELECT id,
                      project_id,
                      title,
                      execution_mode,
                      created_at,
                      updated_at
               FROM chat_threads
               WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatThread,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatThread>(
            r#"INSERT INTO chat_threads (id, project_id, title, execution_mode)
               VALUES ($1, $2, $3, $4)
               RETURNING id,
                         project_id,
                         title,
                         execution_mode,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(data.project_id)
        .bind(&data.title)
        .bind(data.execution_mode.clone())
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        payload: &UpdateChatThread,
    ) -> Result<Self, ChatThreadError> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(ChatThreadError::NotFound)?;

        let title = payload.title.clone().unwrap_or(existing.title);
        let execution_mode = payload
            .execution_mode
            .clone()
            .unwrap_or(existing.execution_mode);

        Ok(sqlx::query_as::<_, ChatThread>(
            r#"UPDATE chat_threads
               SET title = $2,
                   execution_mode = $3,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id,
                         project_id,
                         title,
                         execution_mode,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(title)
        .bind(execution_mode)
        .fetch_one(pool)
        .await?)
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM chat_threads WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        project::{CreateProject, Project},
        project_repo::CreateProjectRepo,
    };
    use sqlx::SqlitePool;

    #[sqlx::test]
    async fn create_update_and_delete_chat_thread(pool: SqlitePool) {
        let project_id = Uuid::new_v4();
        let thread_id = Uuid::new_v4();
        let _project = Project::create(
            &pool,
            &CreateProject {
                name: "test-project".to_string(),
                repositories: Vec::<CreateProjectRepo>::new(),
            },
            project_id,
        )
        .await
        .expect("create project");

        let created = ChatThread::create(
            &pool,
            &CreateChatThread {
                project_id,
                title: "Thread A".to_string(),
                execution_mode: ChatThreadExecutionMode::InPlace,
            },
            thread_id,
        )
        .await
        .expect("create thread");

        assert_eq!(created.id, thread_id);
        assert_eq!(created.project_id, project_id);
        assert_eq!(created.execution_mode, ChatThreadExecutionMode::InPlace);

        let listed = ChatThread::find_by_project_id(&pool, project_id)
            .await
            .expect("list by project");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, thread_id);

        let updated = ChatThread::update(
            &pool,
            thread_id,
            &UpdateChatThread {
                title: Some("Thread B".to_string()),
                execution_mode: Some(ChatThreadExecutionMode::Isolated),
            },
        )
        .await
        .expect("update thread");

        assert_eq!(updated.title, "Thread B");
        assert_eq!(updated.execution_mode, ChatThreadExecutionMode::Isolated);

        let rows = ChatThread::delete(&pool, thread_id)
            .await
            .expect("delete thread");
        assert_eq!(rows, 1);

        let fetched = ChatThread::find_by_id(&pool, thread_id)
            .await
            .expect("find by id");
        assert!(fetched.is_none());
    }
}
