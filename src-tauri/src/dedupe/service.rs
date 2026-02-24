use std::sync::Arc;

use crate::domain::bookmark::{normalize_url, DuplicateCheckResult};
use crate::AppState;

pub async fn check_duplicate_for_url(
    state: &Arc<AppState>,
    raw_url: &str,
) -> Result<DuplicateCheckResult, String> {
    let token = state
        .token_store
        .get_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pinboard token is not set".to_string())?;

    let normalized = normalize_url(raw_url).ok_or_else(|| "Invalid URL".to_string())?;
    let existing = state
        .pinboard
        .get_existing_bookmark(&token, &normalized)
        .await
        .map_err(|e| e.to_string())?;

    Ok(DuplicateCheckResult {
        exists: existing.is_some(),
        bookmark: existing,
    })
}
