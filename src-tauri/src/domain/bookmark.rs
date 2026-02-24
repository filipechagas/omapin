use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmitIntent {
    Create,
    Update,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkPayload {
    pub url: String,
    pub title: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub private: bool,
    pub read_later: bool,
    pub intent: SubmitIntent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingBookmark {
    pub url: String,
    pub title: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub private: bool,
    pub read_later: bool,
    pub time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCheckResult {
    pub exists: bool,
    pub bookmark: Option<ExistingBookmark>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSuggestions {
    pub popular: Vec<String>,
    pub recommended: Vec<String>,
}

pub fn normalize_url(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    Url::parse(&candidate).ok().map(|url| url.to_string())
}

pub fn parse_tags(input: &str) -> Vec<String> {
    input
        .split_whitespace()
        .filter(|t| !t.trim().is_empty())
        .map(ToString::to_string)
        .collect()
}

pub fn merge_tags(existing: &[String], incoming: &[String]) -> Vec<String> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();

    for tag in existing.iter().chain(incoming.iter()) {
        let key = tag.to_lowercase();
        if seen.insert(key) {
            merged.push(tag.clone());
        }
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::{merge_tags, normalize_url};

    #[test]
    fn normalize_url_adds_https() {
        let normalized = normalize_url("news.ycombinator.com").unwrap();
        assert!(normalized.starts_with("https://"));
    }

    #[test]
    fn merge_tags_is_case_insensitive() {
        let merged = merge_tags(
            &["Tech".to_string(), "Rust".to_string()],
            &["tech".to_string(), "Arch".to_string()],
        );
        assert_eq!(merged, vec!["Tech", "Rust", "Arch"]);
    }
}
