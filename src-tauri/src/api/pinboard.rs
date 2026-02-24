use std::time::{Duration, Instant};

use reqwest::Url;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::domain::bookmark::{BookmarkPayload, ExistingBookmark, TagSuggestions};

const PINBOARD_BASE: &str = "https://api.pinboard.in/v1";

#[derive(Debug, thiserror::Error)]
pub enum PinboardError {
    #[error("network error: {0}")]
    Network(String),
    #[error("invalid API response")]
    InvalidResponse,
    #[error("pinboard API error: {0}")]
    Api(String),
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
            if elapsed < Duration::from_secs(3) {
                tokio::time::sleep(Duration::from_secs(3) - elapsed).await;
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

        let mut url = Url::parse(&format!("{PINBOARD_BASE}/{path}"))
            .map_err(|_| PinboardError::InvalidResponse)?;
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
            .map_err(|e| PinboardError::Network(e.to_string()))?;

        if response.status().as_u16() == 429 {
            return Err(PinboardError::Api("rate limited (429)".to_string()));
        }

        let response = response
            .error_for_status()
            .map_err(|e| PinboardError::Network(e.to_string()))?;

        response
            .json::<Value>()
            .await
            .map_err(|e| PinboardError::Network(e.to_string()))
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

        let code = result
            .get("result_code")
            .or_else(|| result.get("code"))
            .and_then(Value::as_str)
            .unwrap_or("");

        if code == "done" {
            Ok(())
        } else {
            Err(PinboardError::Api(code.to_string()))
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
