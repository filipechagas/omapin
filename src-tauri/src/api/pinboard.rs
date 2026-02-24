use std::time::{Duration, Instant};

use reqwest::{header, StatusCode, Url};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::domain::bookmark::{BookmarkPayload, ExistingBookmark, TagSuggestions};

const PINBOARD_BASE: &str = "https://api.pinboard.in/v1";
const PINBOARD_MIN_INTERVAL_SECS: u64 = 3;
const DEFAULT_RETRY_AFTER_SECS: i64 = 30;

#[derive(Debug, thiserror::Error)]
pub enum PinboardError {
    #[error("network error: {message}")]
    Network { message: String },
    #[error("invalid API response: {message}")]
    InvalidResponse { message: String },
    #[error("rate limited: retry after {retry_after_secs}s ({message})")]
    RateLimited {
        retry_after_secs: i64,
        message: String,
    },
    #[error("http {status}: {message}")]
    Http { status: u16, message: String },
    #[error("pinboard API error: {code}")]
    Api { code: String, retryable: bool },
}

impl PinboardError {
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Network { .. } => true,
            Self::InvalidResponse { .. } => true,
            Self::RateLimited { .. } => true,
            Self::Http { status, .. } => {
                *status == 408 || *status == 425 || *status == 429 || *status >= 500
            }
            Self::Api { retryable, .. } => *retryable,
        }
    }

    pub fn retry_after_secs(&self) -> Option<i64> {
        match self {
            Self::RateLimited {
                retry_after_secs, ..
            } => Some(*retry_after_secs),
            Self::Http { status, .. } if *status == 429 => Some(DEFAULT_RETRY_AFTER_SECS),
            _ => None,
        }
    }

    pub fn message_for_user(&self) -> String {
        match self {
            Self::Network { message }
            | Self::InvalidResponse { message }
            | Self::RateLimited { message, .. }
            | Self::Http { message, .. } => message.clone(),
            Self::Api { code, .. } => code.clone(),
        }
    }
}

pub struct PinboardClient {
    client: reqwest::Client,
    last_call: Mutex<Option<Instant>>,
}

impl PinboardClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            last_call: Mutex::new(None),
        }
    }

    async fn wait_rate_limit(&self) {
        let mut guard = self.last_call.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < Duration::from_secs(PINBOARD_MIN_INTERVAL_SECS) {
                tokio::time::sleep(Duration::from_secs(PINBOARD_MIN_INTERVAL_SECS) - elapsed).await;
            }
        }
        *guard = Some(Instant::now());
    }

    async fn get_json(
        &self,
        path: &str,
        params: &[(&str, String)],
    ) -> Result<Value, PinboardError> {
        self.wait_rate_limit().await;

        let mut url = Url::parse(&format!("{PINBOARD_BASE}/{path}")).map_err(|_| {
            PinboardError::InvalidResponse {
                message: "invalid Pinboard URL".to_string(),
            }
        })?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("format", "json");
            for (k, v) in params {
                query.append_pair(k, v);
            }
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| PinboardError::Network {
                message: e.to_string(),
            })?;

        let status = response.status();
        let retry_after = parse_retry_after(response.headers()).unwrap_or(DEFAULT_RETRY_AFTER_SECS);
        let body = response.text().await.map_err(|e| PinboardError::Network {
            message: e.to_string(),
        })?;

        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(PinboardError::RateLimited {
                retry_after_secs: retry_after,
                message: extract_error_message(&body),
            });
        }

        if !status.is_success() {
            return Err(PinboardError::Http {
                status: status.as_u16(),
                message: extract_error_message(&body),
            });
        }

        match serde_json::from_str::<Value>(&body) {
            Ok(value) => Ok(value),
            Err(_) => {
                if let Some(code) = extract_result_code_from_text(&body) {
                    if code.eq_ignore_ascii_case("done") {
                        Ok(json!({ "result_code": "done" }))
                    } else {
                        Err(classify_api_code(&code))
                    }
                } else {
                    Err(PinboardError::InvalidResponse {
                        message: truncate_for_error(&body),
                    })
                }
            }
        }
    }

    pub async fn add_bookmark(
        &self,
        token: &str,
        payload: &BookmarkPayload,
    ) -> Result<(), PinboardError> {
        let replace = match payload.intent {
            crate::domain::bookmark::SubmitIntent::Create => "no",
            crate::domain::bookmark::SubmitIntent::Update => "yes",
        };

        let tags = payload.tags.join(" ");
        let result = self
            .get_json(
                "posts/add",
                &[
                    ("auth_token", token.to_string()),
                    ("url", payload.url.clone()),
                    ("description", payload.title.clone()),
                    ("extended", payload.notes.clone()),
                    ("tags", tags),
                    ("replace", replace.to_string()),
                    (
                        "shared",
                        if payload.private {
                            "no".to_string()
                        } else {
                            "yes".to_string()
                        },
                    ),
                    (
                        "toread",
                        if payload.read_later {
                            "yes".to_string()
                        } else {
                            "no".to_string()
                        },
                    ),
                ],
            )
            .await?;

        let code = extract_result_code(&result).ok_or_else(|| PinboardError::InvalidResponse {
            message: "missing result code from posts/add".to_string(),
        })?;

        if code.eq_ignore_ascii_case("done") {
            Ok(())
        } else {
            Err(classify_api_code(&code))
        }
    }

    pub async fn suggest_tags(
        &self,
        token: &str,
        url: &str,
    ) -> Result<TagSuggestions, PinboardError> {
        let value = self
            .get_json(
                "posts/suggest",
                &[("auth_token", token.to_string()), ("url", url.to_string())],
            )
            .await?;

        let popular = extract_tag_list(&value, "popular");
        let recommended = extract_tag_list(&value, "recommended");
        Ok(TagSuggestions {
            popular,
            recommended,
        })
    }

    pub async fn get_existing_bookmark(
        &self,
        token: &str,
        url: &str,
    ) -> Result<Option<ExistingBookmark>, PinboardError> {
        let value = self
            .get_json(
                "posts/get",
                &[("auth_token", token.to_string()), ("url", url.to_string())],
            )
            .await?;

        let posts = value
            .get("posts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let Some(first) = posts.first() else {
            return Ok(None);
        };

        let tags = first
            .get("tags")
            .or_else(|| first.get("tag"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .split_whitespace()
            .map(ToString::to_string)
            .collect::<Vec<_>>();

        Ok(Some(ExistingBookmark {
            url: first
                .get("href")
                .or_else(|| first.get("url"))
                .and_then(Value::as_str)
                .unwrap_or(url)
                .to_string(),
            title: first
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            notes: first
                .get("extended")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            tags,
            private: matches!(first.get("shared").and_then(Value::as_str), Some("no")),
            read_later: matches!(first.get("toread").and_then(Value::as_str), Some("yes")),
            time: first
                .get("time")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        }))
    }
}

fn parse_retry_after(headers: &header::HeaderMap) -> Option<i64> {
    headers
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| *value > 0)
}

fn extract_result_code(value: &Value) -> Option<String> {
    value
        .get("result_code")
        .or_else(|| value.get("code"))
        .or_else(|| value.get("result"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_result_code_from_text(text: &str) -> Option<String> {
    let marker = "code=\"";
    let start = text.find(marker)? + marker.len();
    let end = text[start..].find('"')?;
    Some(text[start..start + end].to_string())
}

fn classify_api_code(code: &str) -> PinboardError {
    let lower = code.to_ascii_lowercase();

    if lower.contains("rate") || lower.contains("too many requests") {
        return PinboardError::RateLimited {
            retry_after_secs: DEFAULT_RETRY_AFTER_SECS,
            message: code.to_string(),
        };
    }

    let non_retryable = [
        "item already exists",
        "invalid",
        "missing",
        "not found",
        "forbidden",
        "unauthorized",
        "auth",
    ]
    .iter()
    .any(|needle| lower.contains(needle));

    let retryable = !non_retryable
        || ["something went wrong", "temporar", "timeout", "unavailable"]
            .iter()
            .any(|needle| lower.contains(needle));

    PinboardError::Api {
        code: code.to_string(),
        retryable,
    }
}

fn extract_error_message(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "empty response body".to_string();
    }

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if let Some(code) = extract_result_code(&value) {
            return code;
        }

        if let Some(error) = value
            .get("error")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
        {
            return error.to_string();
        }
    }

    if let Some(code) = extract_result_code_from_text(trimmed) {
        return code;
    }

    truncate_for_error(trimmed)
}

fn truncate_for_error(text: &str) -> String {
    const MAX_LEN: usize = 220;
    let clean = text.replace('\n', " ").replace('\r', " ");
    let len = clean.chars().count();
    if len <= MAX_LEN {
        clean
    } else {
        let truncated = clean.chars().take(MAX_LEN).collect::<String>();
        format!("{truncated}...")
    }
}

fn extract_tag_list(value: &Value, key: &str) -> Vec<String> {
    if let Some(arr) = value.get(key).and_then(Value::as_array) {
        return arr
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect();
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(tags) = item.get(key).and_then(Value::as_array) {
                return tags
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect();
            }
        }
    }

    if let Some(obj) = value.as_object() {
        for child in obj.values() {
            if let Some(arr) = child.get(key).and_then(Value::as_array) {
                return arr
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect();
            }
        }
    }

    Vec::new()
}
