use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::dedupe::service::check_duplicate_for_url;
use crate::domain::bookmark::{
    normalize_url, parse_tags, BookmarkPayload, DuplicateCheckResult, TagSuggestions,
};
use crate::queue::worker::process_due_items;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub token_configured: bool,
    pub queue_stats: crate::queue::store::QueueStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResult {
    pub status: String,
    pub message: String,
    pub queued: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRetryResult {
    pub sent: usize,
    pub remaining: u64,
}

#[tauri::command]
pub async fn init_session(state: State<'_, Arc<AppState>>) -> Result<SessionInfo, String> {
    let token_configured = state
        .token_store
        .get_token()
        .map_err(|e| e.to_string())?
        .is_some();

    let queue_stats = state.queue_store.stats().map_err(|e| e.to_string())?;

    Ok(SessionInfo {
        token_configured,
        queue_stats,
    })
}

#[tauri::command]
pub async fn save_token(state: State<'_, Arc<AppState>>, token: String) -> Result<(), String> {
    let clean = token.trim();
    if !clean.contains(':') {
        return Err("Pinboard token should look like username:TOKEN".to_string());
    }

    state
        .token_store
        .set_token(clean)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_token(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.token_store.clear_token().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_tag_suggestions(
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<TagSuggestions, String> {
    let token = state
        .token_store
        .get_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pinboard token is not set".to_string())?;

    let normalized = normalize_url(&url).ok_or_else(|| "Invalid URL".to_string())?;
    state
        .pinboard
        .suggest_tags(&token, &normalized)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_duplicate(
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<DuplicateCheckResult, String> {
    check_duplicate_for_url(state.inner(), &url).await
}

#[tauri::command]
pub async fn submit_bookmark(
    state: State<'_, Arc<AppState>>,
    payload: BookmarkPayload,
) -> Result<SubmitResult, String> {
    let token = state
        .token_store
        .get_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pinboard token is not set".to_string())?;

    let mut clean_payload = payload;
    clean_payload.url =
        normalize_url(&clean_payload.url).ok_or_else(|| "Invalid URL".to_string())?;
    clean_payload.tags = parse_tags(&clean_payload.tags.join(" "));

    match state.pinboard.add_bookmark(&token, &clean_payload).await {
        Ok(_) => Ok(SubmitResult {
            status: "sent".to_string(),
            message: "Saved to Pinboard".to_string(),
            queued: false,
        }),
        Err(err) => {
            if err.is_retryable() {
                let retry_after = err.retry_after_secs().unwrap_or(15);
                state
                    .queue_store
                    .enqueue(&clean_payload, &err.message_for_user(), retry_after)
                    .map_err(|e| e.to_string())?;
                Ok(SubmitResult {
                    status: "queued".to_string(),
                    message: format!(
                        "Pinboard unavailable right now. Queued for retry: {}",
                        err.message_for_user()
                    ),
                    queued: true,
                })
            } else {
                Err(format!(
                    "Pinboard rejected bookmark: {}",
                    err.message_for_user()
                ))
            }
        }
    }
}

#[tauri::command]
pub async fn queue_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::queue::store::QueueItem>, String> {
    state.queue_store.list(50).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_retry_now(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<QueueRetryResult, String> {
    let sent = process_due_items(&app, state.inner(), 25).await?;
    let remaining = state
        .queue_store
        .stats()
        .map_err(|e| e.to_string())?
        .pending;
    Ok(QueueRetryResult { sent, remaining })
}
