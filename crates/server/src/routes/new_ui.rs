use std::path::PathBuf;

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
    repo::Repo,
    session::{CreateSession, Session, SessionError},
    task::{CreateTask, Task, TaskStatus},
    workspace::{CreateWorkspace, Workspace},
    workspace_repo::{CreateWorkspaceRepo, WorkspaceRepo},
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
use sqlx::FromRow;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const NEW_UI_SHARED_TASK_PREFIX: &str = "[new-ui shared] ";
const NEW_UI_SHARED_WORKSPACE_BRANCH: &str = "new-ui-in-place";

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

#[derive(Debug, FromRow)]
struct WorkspaceLookup {
    workspace_id: Uuid,
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

fn workspace_agent_working_dir_for_repos(repos: &[Repo]) -> Option<String> {
    if repos.len() != 1 {
        return None;
    }

    let repo = &repos[0];
    match repo.default_working_dir.as_ref().filter(|s| !s.is_empty()) {
        Some(subdir) => Some(
            PathBuf::from(&repo.name)
                .join(subdir)
                .to_string_lossy()
                .to_string(),
        ),
        None => Some(repo.name.clone()),
    }
}

fn target_branch_for_repo(deployment: &DeploymentImpl, repo: &Repo) -> String {
    repo.default_target_branch
        .clone()
        .or_else(|| {
            deployment
                .git()
                .get_head_info(&repo.path)
                .ok()
                .map(|h| h.branch)
        })
        .unwrap_or_else(|| "main".to_string())
}

pub async fn ensure_project_shared_workspace(
    deployment: &DeploymentImpl,
    project_id: Uuid,
    project_name: &str,
) -> Result<Workspace, ApiError> {
    let pool = &deployment.db().pool;
    let shared_task_title = format!("{}{}", NEW_UI_SHARED_TASK_PREFIX, project_name);

    if let Some(row) = sqlx::query_as::<_, WorkspaceLookup>(
        r#"SELECT w.id as workspace_id
           FROM workspaces w
           JOIN tasks t ON t.id = w.task_id
           WHERE t.project_id = $1 AND t.title = $2
           ORDER BY w.created_at ASC
           LIMIT 1"#,
    )
    .bind(project_id)
    .bind(&shared_task_title)
    .fetch_optional(pool)
    .await?
    {
        return Workspace::find_by_id(pool, row.workspace_id)
            .await?
            .ok_or_else(|| ApiError::BadRequest("Shared workspace not found".to_string()));
    }

    let repos = ProjectRepo::find_repos_for_project(pool, project_id).await?;
    if repos.is_empty() {
        return Err(ApiError::BadRequest(
            "Project has no repositories".to_string(),
        ));
    }

    let task = Task::create(
        pool,
        &CreateTask {
            project_id,
            title: shared_task_title,
            description: Some("Internal shared workspace for /new-ui in-place threads".to_string()),
            status: Some(TaskStatus::Todo),
            parent_workspace_id: None,
            image_ids: None,
        },
        Uuid::new_v4(),
    )
    .await?;

    let workspace = Workspace::create(
        pool,
        &CreateWorkspace {
            branch: NEW_UI_SHARED_WORKSPACE_BRANCH.to_string(),
            agent_working_dir: workspace_agent_working_dir_for_repos(&repos),
        },
        Uuid::new_v4(),
        task.id,
    )
    .await?;

    let workspace_repos: Vec<CreateWorkspaceRepo> = repos
        .iter()
        .map(|repo| CreateWorkspaceRepo {
            repo_id: repo.id,
            target_branch: target_branch_for_repo(deployment, repo),
        })
        .collect();
    WorkspaceRepo::create_many(pool, workspace.id, &workspace_repos).await?;

    if repos.len() == 1
        && let Some(parent) = repos[0].path.parent()
    {
        Workspace::update_container_ref(pool, workspace.id, &parent.to_string_lossy()).await?;
    }

    Workspace::find_by_id(pool, workspace.id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Failed to load shared workspace".to_string()))
}

async fn provision_isolated_workspace_for_thread(
    deployment: &DeploymentImpl,
    thread: &ChatThread,
) -> Result<Workspace, ApiError> {
    let pool = &deployment.db().pool;
    let repos = ProjectRepo::find_repos_for_project(pool, thread.project_id).await?;

    if repos.is_empty() {
        return Err(ApiError::BadRequest(
            "Project has no repositories".to_string(),
        ));
    }

    let task_title = format!("[new-ui thread] {} ({})", thread.title, thread.id);
    let task = Task::create(
        pool,
        &CreateTask {
            project_id: thread.project_id,
            title: task_title.clone(),
            description: Some("Internal workspace for isolated /new-ui thread".to_string()),
            status: Some(TaskStatus::Todo),
            parent_workspace_id: None,
            image_ids: None,
        },
        Uuid::new_v4(),
    )
    .await?;

    let workspace_id = Uuid::new_v4();
    let branch = deployment
        .container()
        .git_branch_from_workspace(&workspace_id, &task_title)
        .await;

    let workspace = Workspace::create(
        pool,
        &CreateWorkspace {
            branch,
            agent_working_dir: workspace_agent_working_dir_for_repos(&repos),
        },
        workspace_id,
        task.id,
    )
    .await?;

    let workspace_repos: Vec<CreateWorkspaceRepo> = repos
        .iter()
        .map(|repo| CreateWorkspaceRepo {
            repo_id: repo.id,
            target_branch: target_branch_for_repo(deployment, repo),
        })
        .collect();
    WorkspaceRepo::create_many(pool, workspace.id, &workspace_repos).await?;

    Workspace::find_by_id(pool, workspace.id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Failed to load isolated workspace".to_string()))
}

pub async fn list_threads(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatThread>>>, ApiError> {
    let pool = &deployment.db().pool;
    let project = Project::find_by_id(pool, project_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;

    ensure_project_is_single_repo(pool, project_id).await?;
    let _ = ensure_project_shared_workspace(&deployment, project.id, &project.name).await?;

    let threads = ChatThread::find_by_project_id(pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(threads)))
}

pub async fn create_thread(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<CreateThreadRequest>,
) -> Result<ResponseJson<ApiResponse<ChatThread>>, ApiError> {
    let pool = &deployment.db().pool;
    let project = Project::find_by_id(pool, project_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;

    ensure_project_is_single_repo(pool, project_id).await?;

    let execution_mode = payload
        .execution_mode
        .unwrap_or(ChatThreadExecutionMode::InPlace);

    let thread = ChatThread::create(
        pool,
        &CreateChatThread {
            project_id,
            title: payload.title,
            execution_mode: execution_mode.clone(),
        },
        Uuid::new_v4(),
    )
    .await?;

    let workspace = match execution_mode {
        ChatThreadExecutionMode::InPlace => {
            ensure_project_shared_workspace(&deployment, project.id, &project.name).await?
        }
        ChatThreadExecutionMode::Isolated => {
            provision_isolated_workspace_for_thread(&deployment, &thread).await?
        }
    };

    let _binding = ChatThreadBinding::upsert(
        pool,
        &UpsertChatThreadBinding {
            thread_id: thread.id,
            session_id: None,
            workspace_id: Some(workspace.id),
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
    let pool = &deployment.db().pool;
    let existing = ChatThread::find_by_id(pool, thread_id)
        .await?
        .ok_or(ChatThreadError::NotFound)?;

    if let Some(next_mode) = payload.execution_mode.clone()
        && next_mode != existing.execution_mode
    {
        let project = Project::find_by_id(pool, existing.project_id)
            .await?
            .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;
        let target_workspace = match next_mode {
            ChatThreadExecutionMode::InPlace => {
                ensure_project_shared_workspace(&deployment, project.id, &project.name).await?
            }
            ChatThreadExecutionMode::Isolated => {
                provision_isolated_workspace_for_thread(&deployment, &existing).await?
            }
        };

        // Session is mode/workspace-specific; clear it on mode switch.
        ChatThreadBinding::upsert(
            pool,
            &UpsertChatThreadBinding {
                thread_id: existing.id,
                session_id: None,
                workspace_id: Some(target_workspace.id),
            },
        )
        .await?;
    }

    let updated = ChatThread::update(pool, thread_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

async fn resolve_thread_workspace(
    deployment: &DeploymentImpl,
    thread: &ChatThread,
) -> Result<Workspace, ApiError> {
    let pool = &deployment.db().pool;
    let project = Project::find_by_id(pool, thread.project_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Project not found".to_string()))?;

    let existing_binding = ChatThreadBinding::find_by_thread_id(pool, thread.id).await?;

    if let Some(binding) = &existing_binding
        && let Some(workspace_id) = binding.workspace_id
        && let Some(workspace) = Workspace::find_by_id(pool, workspace_id).await?
    {
        return Ok(workspace);
    }

    let workspace = match thread.execution_mode {
        ChatThreadExecutionMode::InPlace => {
            ensure_project_shared_workspace(deployment, project.id, &project.name).await?
        }
        ChatThreadExecutionMode::Isolated => {
            provision_isolated_workspace_for_thread(deployment, thread).await?
        }
    };

    ChatThreadBinding::upsert(
        pool,
        &UpsertChatThreadBinding {
            thread_id: thread.id,
            session_id: existing_binding.and_then(|b| b.session_id),
            workspace_id: Some(workspace.id),
        },
    )
    .await?;

    Ok(workspace)
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

    ensure_project_is_single_repo(pool, thread.project_id).await?;

    if matches!(thread.execution_mode, ChatThreadExecutionMode::InPlace)
        && payload.retry_process_id.is_some()
    {
        return Err(ApiError::BadRequest(
            "Retry/reset is not supported for in_place threads yet".to_string(),
        ));
    }

    let workspace = resolve_thread_workspace(&deployment, &thread).await?;

    if matches!(thread.execution_mode, ChatThreadExecutionMode::Isolated) {
        deployment
            .container()
            .ensure_container_exists(&workspace)
            .await?;
    }

    let binding = ChatThreadBinding::find_by_thread_id(pool, thread.id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Thread binding is missing".to_string()))?;

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
            "/new-ui/projects/{project_id}/threads",
            get(list_threads).post(create_thread),
        )
        .route("/new-ui/threads/{thread_id}", patch(update_thread))
        .route("/new-ui/threads/{thread_id}/messages", post(send_message))
        .route(
            "/new-ui/threads/{thread_id}/processes/stream/ws",
            get(stream_thread_execution_processes_ws),
        )
}
