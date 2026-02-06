use anyhow;
use axum::{
    Json, Router,
    extract::{
        Path, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Json as ResponseJson},
    routing::{get, patch, post},
};
use db::models::{
    chat_thread::{
        ChatThread, ChatThreadError, ChatThreadExecutionMode, CreateChatThread, UpdateChatThread,
    },
    chat_thread_binding::{ChatThreadBinding, UpsertChatThreadBinding},
    coding_agent_turn::CodingAgentTurn,
    execution_process::{ExecutionProcess, ExecutionProcessRunReason},
    project::Project,
    project_repo::ProjectRepo,
    session::{CreateSession, Session, SessionError},
    workspace::{Workspace, WorkspaceError},
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType, coding_agent_follow_up::CodingAgentFollowUpRequest,
    },
    profile::ExecutorProfileId,
};
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use serde::Deserialize;
use services::services::container::ContainerService;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct CreateThreadRequest {
    pub title: String,
    pub execution_mode: Option<ChatThreadExecutionMode>,
}

#[derive(Debug, Deserialize, TS)]
pub struct SendThreadMessageRequest {
    pub prompt: String,
    pub executor_profile_id: ExecutorProfileId,
    pub retry_process_id: Option<Uuid>,
    pub force_when_dirty: Option<bool>,
    pub perform_git_reset: Option<bool>,
}

async fn ensure_project_is_single_repo(
    pool: &sqlx::SqlitePool,
    project_id: Uuid,
) -> Result<(), ApiError> {
    let repo_links = ProjectRepo::find_by_project_id(pool, project_id).await?;
    if repo_links.len() != 1 {
        return Err(ApiError::BadRequest(
            "new-ui requires projects with exactly one repository".to_string(),
        ));
    }
    Ok(())
}

pub async fn list_threads(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatThread>>>, ApiError> {
    let pool = &deployment.db().pool;
    let _project = Project::find_by_id(pool, project_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;

    ensure_project_is_single_repo(pool, project_id).await?;

    let threads = ChatThread::find_by_project_id(pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(threads)))
}

pub async fn create_thread(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<CreateThreadRequest>,
) -> Result<ResponseJson<ApiResponse<ChatThread>>, ApiError> {
    let pool = &deployment.db().pool;
    let _project = Project::find_by_id(pool, project_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;

    ensure_project_is_single_repo(pool, project_id).await?;

    let thread = ChatThread::create(
        pool,
        &CreateChatThread {
            project_id,
            title: payload.title,
            execution_mode: payload
                .execution_mode
                .unwrap_or(ChatThreadExecutionMode::InPlace),
        },
        Uuid::new_v4(),
    )
    .await?;

    // Ensure there is always a binding row for the thread; phase 4 will populate workspace/session.
    let _binding = ChatThreadBinding::upsert(
        pool,
        &UpsertChatThreadBinding {
            thread_id: thread.id,
            session_id: None,
            workspace_id: None,
        },
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(thread)))
}

pub async fn update_thread(
    State(deployment): State<DeploymentImpl>,
    Path(thread_id): Path<Uuid>,
    Json(payload): Json<UpdateChatThread>,
) -> Result<ResponseJson<ApiResponse<ChatThread>>, ApiError> {
    let updated = ChatThread::update(&deployment.db().pool, thread_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn send_message(
    State(deployment): State<DeploymentImpl>,
    Path(thread_id): Path<Uuid>,
    Json(payload): Json<SendThreadMessageRequest>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess>>, ApiError> {
    let pool = &deployment.db().pool;
    let thread = ChatThread::find_by_id(pool, thread_id)
        .await?
        .ok_or(ChatThreadError::NotFound)?;

    match thread.execution_mode {
        ChatThreadExecutionMode::InPlace => Err(ApiError::BadRequest(
            "in_place execution mode is not wired yet (Phase 3)".to_string(),
        )),
        ChatThreadExecutionMode::Isolated => {
            send_message_isolated(&deployment, &thread, payload).await
        }
    }
}

async fn send_message_isolated(
    deployment: &DeploymentImpl,
    thread: &ChatThread,
    payload: SendThreadMessageRequest,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess>>, ApiError> {
    let pool = &deployment.db().pool;
    ensure_project_is_single_repo(pool, thread.project_id).await?;

    let binding = ChatThreadBinding::find_by_thread_id(pool, thread.id)
        .await?
        .ok_or_else(|| {
            ApiError::BadRequest("Thread binding is missing for isolated execution".to_string())
        })?;

    let workspace_id = binding.workspace_id.ok_or_else(|| {
        ApiError::BadRequest(
            "Thread is isolated but has no workspace bound yet (Phase 4 will provision this)"
                .to_string(),
        )
    })?;

    let workspace = Workspace::find_by_id(pool, workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;

    let session = match binding.session_id {
        Some(session_id) => Session::find_by_id(pool, session_id)
            .await?
            .ok_or(ApiError::Session(SessionError::NotFound))?,
        None => {
            let created = Session::create(
                pool,
                &CreateSession {
                    executor: Some(payload.executor_profile_id.executor.to_string()),
                },
                Uuid::new_v4(),
                workspace.id,
            )
            .await?;

            ChatThreadBinding::upsert(
                pool,
                &UpsertChatThreadBinding {
                    thread_id: thread.id,
                    session_id: Some(created.id),
                    workspace_id: Some(workspace.id),
                },
            )
            .await?;

            created
        }
    };

    let expected_executor: Option<String> =
        ExecutionProcess::latest_executor_profile_for_session(pool, session.id)
            .await?
            .map(|profile| profile.executor.to_string())
            .or_else(|| session.executor.clone());

    if let Some(expected) = expected_executor {
        let actual = payload.executor_profile_id.executor.to_string();
        if expected != actual {
            return Err(ApiError::Session(SessionError::ExecutorMismatch {
                expected,
                actual,
            }));
        }
    }

    if session.executor.is_none() {
        Session::update_executor(
            pool,
            session.id,
            &payload.executor_profile_id.executor.to_string(),
        )
        .await?;
    }

    if let Some(proc_id) = payload.retry_process_id {
        let force_when_dirty = payload.force_when_dirty.unwrap_or(false);
        let perform_git_reset = payload.perform_git_reset.unwrap_or(true);
        deployment
            .container()
            .reset_session_to_process(session.id, proc_id, perform_git_reset, force_when_dirty)
            .await?;
    }

    let latest_session_info = CodingAgentTurn::find_latest_session_info(pool, session.id).await?;
    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let cleanup_action = deployment.container().cleanup_actions_for_repos(&repos);
    let working_dir = workspace
        .agent_working_dir
        .as_ref()
        .filter(|dir| !dir.is_empty())
        .cloned();

    let action_type = if let Some(info) = latest_session_info {
        let is_reset = payload.retry_process_id.is_some();
        ExecutorActionType::CodingAgentFollowUpRequest(CodingAgentFollowUpRequest {
            prompt: payload.prompt.clone(),
            session_id: info.session_id,
            reset_to_message_id: if is_reset { info.message_id } else { None },
            executor_profile_id: payload.executor_profile_id.clone(),
            working_dir: working_dir.clone(),
        })
    } else {
        ExecutorActionType::CodingAgentInitialRequest(
            executors::actions::coding_agent_initial::CodingAgentInitialRequest {
                prompt: payload.prompt,
                executor_profile_id: payload.executor_profile_id,
                working_dir,
            },
        )
    };

    let action = ExecutorAction::new(action_type, cleanup_action.map(Box::new));
    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &action,
            &ExecutionProcessRunReason::CodingAgent,
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

pub async fn stream_thread_execution_processes_ws(
    ws: WebSocketUpgrade,
    State(deployment): State<DeploymentImpl>,
    Path(thread_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let session_id = ChatThreadBinding::find_by_thread_id(&deployment.db().pool, thread_id)
        .await?
        .and_then(|binding| binding.session_id)
        .ok_or_else(|| ApiError::BadRequest("Thread has no session bound yet".to_string()))?;

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_thread_execution_processes_ws(socket, deployment, session_id).await {
            tracing::warn!("thread execution processes WS closed: {}", e);
        }
    }))
}

async fn handle_thread_execution_processes_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    session_id: Uuid,
) -> anyhow::Result<()> {
    let mut stream = deployment
        .events()
        .stream_execution_processes_for_session_raw(session_id, false)
        .await?
        .map_ok(|msg| msg.to_ws_message_unchecked());

    let (mut sender, mut receiver) = socket.split();
    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    while let Some(item) = stream.next().await {
        match item {
            Ok(msg) => {
                if sender.send(msg).await.is_err() {
                    break;
                }
            }
            Err(e) => {
                tracing::error!("stream error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/projects/{project_id}/threads",
            get(list_threads).post(create_thread),
        )
        .route("/threads/{thread_id}", patch(update_thread))
        .route("/threads/{thread_id}/messages", post(send_message))
        .route(
            "/threads/{thread_id}/processes/stream/ws",
            get(stream_thread_execution_processes_ws),
        )
}
