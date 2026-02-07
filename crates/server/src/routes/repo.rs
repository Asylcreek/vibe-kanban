use axum::{
    Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
    Json,
};
use db::models::{
    project::SearchResult,
    repo::{Repo, UpdateRepo},
};
use deployment::Deployment;
use git::{Commit, DiffTarget, GitBranch, GitRemote, GitCli};
use serde::{Deserialize, Serialize};
use services::services::{
    file_search::SearchQuery,
    git_host::{GitHostError, GitHostProvider, GitHostService, OpenPrInfo, ProviderKind},
};
use ts_rs::TS;
use utils::diff::Diff;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{
    DeploymentImpl,
    error::ApiError,
    routes::projects::{OpenEditorRequest, OpenEditorResponse},
};

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct RegisterRepoRequest {
    pub path: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct InitRepoRequest {
    pub parent_path: String,
    pub folder_name: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct BatchRepoRequest {
    pub ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct RevertFileRequest {
    pub file_path: String,
}

pub async fn register_repo(
    State(deployment): State<DeploymentImpl>,
    ResponseJson(payload): ResponseJson<RegisterRepoRequest>,
) -> Result<ResponseJson<ApiResponse<Repo>>, ApiError> {
    let repo = deployment
        .repo()
        .register(
            &deployment.db().pool,
            &payload.path,
            payload.display_name.as_deref(),
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(repo)))
}

pub async fn init_repo(
    State(deployment): State<DeploymentImpl>,
    ResponseJson(payload): ResponseJson<InitRepoRequest>,
) -> Result<ResponseJson<ApiResponse<Repo>>, ApiError> {
    let repo = deployment
        .repo()
        .init_repo(
            &deployment.db().pool,
            deployment.git(),
            &payload.parent_path,
            &payload.folder_name,
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(repo)))
}

pub async fn get_repo_branches(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<GitBranch>>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;

    let branches = deployment.git().get_all_branches(&repo.path)?;
    Ok(ResponseJson(ApiResponse::success(branches)))
}

pub async fn get_repo_remotes(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<GitRemote>>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;

    let remotes = deployment.git().list_remotes(&repo.path)?;
    Ok(ResponseJson(ApiResponse::success(remotes)))
}

pub async fn get_repos_batch(
    State(deployment): State<DeploymentImpl>,
    ResponseJson(payload): ResponseJson<BatchRepoRequest>,
) -> Result<ResponseJson<ApiResponse<Vec<Repo>>>, ApiError> {
    let repos = Repo::find_by_ids(&deployment.db().pool, &payload.ids).await?;
    Ok(ResponseJson(ApiResponse::success(repos)))
}

pub async fn get_repos(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Repo>>>, ApiError> {
    let repos = Repo::list_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(repos)))
}

pub async fn get_repo(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Repo>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;
    Ok(ResponseJson(ApiResponse::success(repo)))
}

pub async fn update_repo(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
    ResponseJson(payload): ResponseJson<UpdateRepo>,
) -> Result<ResponseJson<ApiResponse<Repo>>, ApiError> {
    let repo = Repo::update(&deployment.db().pool, repo_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(repo)))
}

pub async fn open_repo_in_editor(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
    ResponseJson(payload): ResponseJson<Option<OpenEditorRequest>>,
) -> Result<ResponseJson<ApiResponse<OpenEditorResponse>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;

    let editor_config = {
        let config = deployment.config().read().await;
        let editor_type_str = payload.as_ref().and_then(|req| req.editor_type.as_deref());
        config.editor.with_override(editor_type_str)
    };

    match editor_config.open_file(&repo.path).await {
        Ok(url) => {
            tracing::info!(
                "Opened editor for repo {} at path: {}{}",
                repo_id,
                repo.path.to_string_lossy(),
                if url.is_some() { " (remote mode)" } else { "" }
            );

            deployment
                .track_if_analytics_allowed(
                    "repo_editor_opened",
                    serde_json::json!({
                        "repo_id": repo_id.to_string(),
                        "editor_type": payload.as_ref().and_then(|req| req.editor_type.as_ref()),
                        "remote_mode": url.is_some(),
                    }),
                )
                .await;

            Ok(ResponseJson(ApiResponse::success(OpenEditorResponse {
                url,
            })))
        }
        Err(e) => {
            tracing::error!("Failed to open editor for repo {}: {:?}", repo_id, e);
            Err(ApiError::EditorOpen(e))
        }
    }
}

pub async fn search_repo(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
    Query(search_query): Query<SearchQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<SearchResult>>>, StatusCode> {
    if search_query.q.trim().is_empty() {
        return Ok(ResponseJson(ApiResponse::error(
            "Query parameter 'q' is required and cannot be empty",
        )));
    }

    let repo = match deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await
    {
        Ok(repo) => repo,
        Err(e) => {
            tracing::error!("Failed to get repo {}: {}", repo_id, e);
            return Err(StatusCode::NOT_FOUND);
        }
    };

    match deployment
        .file_search_cache()
        .search_repo(&repo.path, &search_query.q, search_query.mode)
        .await
    {
        Ok(results) => Ok(ResponseJson(ApiResponse::success(results))),
        Err(e) => {
            tracing::error!("Failed to search files in repo {}: {}", repo_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum ListPrsError {
    CliNotInstalled { provider: ProviderKind },
    AuthFailed { message: String },
    UnsupportedProvider,
}

#[derive(Debug, Deserialize)]
pub struct ListPrsQuery {
    pub remote: Option<String>,
}

pub async fn list_open_prs(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
    Query(query): Query<ListPrsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<OpenPrInfo>, ListPrsError>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;

    let remote = match query.remote {
        Some(name) => GitRemote {
            url: deployment.git().get_remote_url(&repo.path, &name)?,
            name,
        },
        None => deployment.git().get_default_remote(&repo.path)?,
    };

    let git_host = match GitHostService::from_url(&remote.url) {
        Ok(host) => host,
        Err(GitHostError::UnsupportedProvider) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                ListPrsError::UnsupportedProvider,
            )));
        }
        Err(e) => {
            tracing::error!("Failed to create git host service: {}", e);
            return Ok(ResponseJson(ApiResponse::error(&e.to_string())));
        }
    };

    match git_host.list_open_prs(&repo.path, &remote.url).await {
        Ok(prs) => Ok(ResponseJson(ApiResponse::success(prs))),
        Err(GitHostError::CliNotInstalled { provider }) => Ok(ResponseJson(
            ApiResponse::error_with_data(ListPrsError::CliNotInstalled { provider }),
        )),
        Err(GitHostError::AuthFailed(message)) => Ok(ResponseJson(ApiResponse::error_with_data(
            ListPrsError::AuthFailed { message },
        ))),
        Err(GitHostError::UnsupportedProvider) => Ok(ResponseJson(ApiResponse::error_with_data(
            ListPrsError::UnsupportedProvider,
        ))),
        Err(e) => {
            tracing::error!("Failed to list open PRs for repo {}: {}", repo_id, e);
            Ok(ResponseJson(ApiResponse::error(&e.to_string())))
        }
    }
}

pub async fn get_repo_diff(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<Diff>>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;

    // Get current HEAD commit
    let repo_obj = deployment.git().open_repo(&repo.path)?;
    let head = repo_obj.head()?;
    let head_commit = head.peel_to_commit()?;

    // Compare working directory vs HEAD (not HEAD^) to show uncommitted changes
    let base_commit = Commit::new(head_commit.id());

    // Compute diffs
    let diffs = deployment
        .git()
        .get_diffs(DiffTarget::Worktree {
            worktree_path: &repo.path,
            base_commit: &base_commit,
        }, None)?;

    Ok(ResponseJson(ApiResponse::success(diffs)))
}

pub async fn revert_file(
    State(deployment): State<DeploymentImpl>,
    Path(repo_id): Path<Uuid>,
    Json(req): Json<RevertFileRequest>,
) -> Result<ResponseJson<ApiResponse<String>>, ApiError> {
    let repo = deployment
        .repo()
        .get_by_id(&deployment.db().pool, repo_id)
        .await?;

    let repo_path = &repo.path;
    let file_path = &req.file_path;

    // Validate the file path is within the repo
    let full_path = repo_path.join(file_path);
    let canonical_repo = std::fs::canonicalize(repo_path)
        .map_err(|e| ApiError::BadRequest(format!("Invalid repo path: {}", e)))?;
    
    // For new files, they won't exist yet, so skip canonicalization
    if full_path.exists() {
        let canonical_file = std::fs::canonicalize(&full_path)
            .map_err(|e| ApiError::BadRequest(format!("Invalid file path: {}", e)))?;
        
        if !canonical_file.starts_with(&canonical_repo) {
            return Err(ApiError::BadRequest(
                "File path is outside the repository".to_string(),
            ));
        }
    }

    // Use git restore to discard changes (works for tracked files)
    // This will restore the file to its state in HEAD
    let git_cli = GitCli::new();
    let restore_result = git_cli.git(repo_path, ["restore", file_path]);
    
    match restore_result {
        Ok(_) => {
            // Successfully restored from HEAD (file was tracked)
            Ok(ResponseJson(ApiResponse::success(format!("Reverted {}", file_path))))
        }
        Err(_) => {
            // File might be new/untracked, try to remove it
            if full_path.exists() {
                std::fs::remove_file(&full_path)
                    .map_err(|e| ApiError::BadRequest(format!("Failed to remove file: {}", e)))?;
                Ok(ResponseJson(ApiResponse::success(format!("Deleted new file {}", file_path))))
            } else {
                Err(ApiError::BadRequest(
                    format!("File not found: {}", file_path)
                ))
            }
        }
    }
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/repos", get(get_repos).post(register_repo))
        .route("/repos/init", post(init_repo))
        .route("/repos/batch", post(get_repos_batch))
        .route("/repos/{repo_id}", get(get_repo).put(update_repo))
        .route("/repos/{repo_id}/branches", get(get_repo_branches))
        .route("/repos/{repo_id}/remotes", get(get_repo_remotes))
        .route("/repos/{repo_id}/diff", get(get_repo_diff))
        .route("/repos/{repo_id}/revert-file", post(revert_file))
        .route("/repos/{repo_id}/prs", get(list_open_prs))
        .route("/repos/{repo_id}/search", get(search_repo))
        .route("/repos/{repo_id}/open-editor", post(open_repo_in_editor))
}
