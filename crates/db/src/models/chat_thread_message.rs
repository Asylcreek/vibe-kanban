use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ChatThreadMessageError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display)]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ChatThreadMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatThreadMessage {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub role: ChatThreadMessageRole,
    pub content: String,
    pub execution_process_id: Option<Uuid>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateChatThreadMessage {
    pub thread_id: Uuid,
    pub role: ChatThreadMessageRole,
    pub content: String,
    pub execution_process_id: Option<Uuid>,
}

impl ChatThreadMessage {
    pub async fn find_by_thread_id(
        pool: &SqlitePool,
        thread_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, ChatThreadMessage>(
            r#"SELECT id,
                      thread_id,
                      role,
                      content,
                      execution_process_id,
                      created_at,
                      updated_at
               FROM chat_thread_messages
               WHERE thread_id = $1
               ORDER BY created_at ASC"#,
        )
        .bind(thread_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatThreadMessage,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatThreadMessage>(
            r#"INSERT INTO chat_thread_messages (id, thread_id, role, content, execution_process_id)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id,
                         thread_id,
                         role,
                         content,
                         execution_process_id,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(data.thread_id)
        .bind(data.role.clone())
        .bind(&data.content)
        .bind(data.execution_process_id)
        .fetch_one(pool)
        .await
    }

    pub async fn upsert_assistant_for_process(
        pool: &SqlitePool,
        thread_id: Uuid,
        execution_process_id: Uuid,
        content: String,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ChatThreadMessage>(
            r#"INSERT INTO chat_thread_messages (
                    id,
                    thread_id,
                    role,
                    content,
                    execution_process_id
               )
               VALUES ($1, $2, 'assistant', $3, $4)
               ON CONFLICT(thread_id, role, execution_process_id) DO UPDATE SET
                    content = excluded.content,
                    updated_at = datetime('now', 'subsec')
               RETURNING id,
                         thread_id,
                         role,
                         content,
                         execution_process_id,
                         created_at,
                         updated_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(thread_id)
        .bind(content)
        .bind(execution_process_id)
        .fetch_one(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        chat_thread::{ChatThread, ChatThreadExecutionMode, CreateChatThread},
        project::{CreateProject, Project},
        project_repo::CreateProjectRepo,
    };
    use sqlx::SqlitePool;

    #[sqlx::test]
    async fn create_list_and_upsert_thread_messages(pool: SqlitePool) {
        let project = Project::create(
            &pool,
            &CreateProject {
                name: "test-project".to_string(),
                repositories: Vec::<CreateProjectRepo>::new(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project");

        let thread = ChatThread::create(
            &pool,
            &CreateChatThread {
                project_id: project.id,
                title: "thread".to_string(),
                execution_mode: ChatThreadExecutionMode::InPlace,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create thread");

        let user = ChatThreadMessage::create(
            &pool,
            &CreateChatThreadMessage {
                thread_id: thread.id,
                role: ChatThreadMessageRole::User,
                content: "hello".to_string(),
                execution_process_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create user message");

        let process_id = Uuid::new_v4();
        let assistant = ChatThreadMessage::upsert_assistant_for_process(
            &pool,
            thread.id,
            process_id,
            "draft".to_string(),
        )
        .await
        .expect("upsert assistant");

        let updated = ChatThreadMessage::upsert_assistant_for_process(
            &pool,
            thread.id,
            process_id,
            "final".to_string(),
        )
        .await
        .expect("upsert assistant update");

        let messages = ChatThreadMessage::find_by_thread_id(&pool, thread.id)
            .await
            .expect("list messages");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].id, user.id);
        assert_eq!(messages[1].id, assistant.id);
        assert_eq!(updated.id, assistant.id);
        assert_eq!(updated.content, "final");
    }
}
