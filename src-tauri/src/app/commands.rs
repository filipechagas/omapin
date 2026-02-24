use std::{collections::BTreeMap, env, fs, path::PathBuf, sync::Arc, time::Duration};

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmarchyTheme {
    pub name: String,
    pub colors: BTreeMap<String, String>,
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
pub async fn fetch_user_tags(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    let token = state
        .token_store
        .get_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pinboard token is not set".to_string())?;

    state
        .pinboard
        .get_user_tags(&token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_url_title(url: String) -> Result<Option<String>, String> {
    let normalized = normalize_url(&url).ok_or_else(|| "Invalid URL".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(normalized)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let html = response.text().await.map_err(|e| e.to_string())?;
    Ok(extract_html_title(&html))
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

#[tauri::command]
pub async fn get_omarchy_theme() -> Result<Option<OmarchyTheme>, String> {
    let config_root = env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var("HOME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|home| PathBuf::from(home).join(".config"))
        })
        .ok_or_else(|| "Could not resolve config directory".to_string())?;

    let current_dir = config_root.join("omarchy/current");
    let theme_name_path = current_dir.join("theme.name");
    let colors_path = current_dir.join("theme/colors.toml");

    if !theme_name_path.exists() || !colors_path.exists() {
        return Ok(None);
    }

    let name = fs::read_to_string(theme_name_path)
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    let colors_raw = fs::read_to_string(colors_path).map_err(|e| e.to_string())?;
    let colors = parse_omarchy_colors(&colors_raw);

    if name.is_empty() || colors.is_empty() {
        return Ok(None);
    }

    Ok(Some(OmarchyTheme { name, colors }))
}

fn extract_html_title(html: &str) -> Option<String> {
    let start_title = find_ascii_case_insensitive(html, "<title")?;
    let start_content = html[start_title..].find('>')? + start_title + 1;
    let end_relative = find_ascii_case_insensitive(&html[start_content..], "</title>")?;
    let raw_title = html[start_content..start_content + end_relative].trim();

    if raw_title.is_empty() {
        return None;
    }

    let collapsed = raw_title.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(decode_html_entities(&collapsed))
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let haystack_bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();

    if needle_bytes.is_empty() {
        return Some(0);
    }

    if needle_bytes.len() > haystack_bytes.len() {
        return None;
    }

    for index in 0..=haystack_bytes.len() - needle_bytes.len() {
        if haystack_bytes[index..index + needle_bytes.len()]
            .iter()
            .zip(needle_bytes.iter())
            .all(|(hay, nee)| hay.to_ascii_lowercase() == nee.to_ascii_lowercase())
        {
            return Some(index);
        }
    }

    None
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn parse_omarchy_colors(raw: &str) -> BTreeMap<String, String> {
    let mut colors = BTreeMap::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            let clean_key = key.trim();
            let clean_value = value.trim().trim_matches('"');

            if clean_key.is_empty() || clean_value.is_empty() {
                continue;
            }

            if clean_value.starts_with('#')
                && (clean_value.len() == 7 || clean_value.len() == 9)
                && clean_value.chars().skip(1).all(|ch| ch.is_ascii_hexdigit())
            {
                colors.insert(clean_key.to_string(), clean_value.to_string());
            }
        }
    }

    colors
}
