use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

use crate::domain::bookmark::BookmarkPayload;
use crate::infra::db::{database_path, open_db};

const MIN_QUEUE_DELAY_SECS: i64 = 3;
const MAX_RETRY_ATTEMPTS: i64 = 12;

#[derive(Debug, thiserror::Error)]
pub enum QueueStoreError {
    #[error("db error: {0}")]
    Db(String),
    #[error("serialization error: {0}")]
    Serde(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStats {
    pub pending: u64,
    pub failed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: i64,
    pub payload: BookmarkPayload,
    pub attempt_count: i64,
    pub next_attempt_at: i64,
    pub last_error: Option<String>,
}

pub struct QueueStore {
    db_path: PathBuf,
}

impl QueueStore {
    pub fn new(custom_path: &str) -> Result<Self, QueueStoreError> {
        let db_path = database_path(custom_path);
        open_db(&db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        Ok(Self { db_path })
    }

    pub fn enqueue(
        &self,
        payload: &BookmarkPayload,
        err: &str,
        initial_delay_secs: i64,
    ) -> Result<(), QueueStoreError> {
        let conn = open_db(&self.db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        let now = now_unix();
        let next_attempt = now + initial_delay_secs.max(MIN_QUEUE_DELAY_SECS);
        let payload_json =
            serde_json::to_string(payload).map_err(|e| QueueStoreError::Serde(e.to_string()))?;
        conn.execute(
            "INSERT INTO queue_items(payload_json, status, attempt_count, next_attempt_at, last_error, created_at, updated_at)
             VALUES(?1, 'pending', 0, ?2, ?3, ?2, ?2)",
            params![payload_json, next_attempt, err],
        )
        .map_err(|e| QueueStoreError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn due_items(&self, limit: usize) -> Result<Vec<QueueItem>, QueueStoreError> {
        let conn = open_db(&self.db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        let now = now_unix();
        let mut stmt = conn
            .prepare(
                "SELECT id, payload_json, attempt_count, next_attempt_at, last_error
                 FROM queue_items
                 WHERE status = 'pending' AND next_attempt_at <= ?1
                 ORDER BY next_attempt_at ASC
                 LIMIT ?2",
            )
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;

        let rows = stmt
            .query_map(params![now, limit as i64], map_row)
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| QueueStoreError::Db(e.to_string()))
    }

    pub fn list(&self, limit: usize) -> Result<Vec<QueueItem>, QueueStoreError> {
        let conn = open_db(&self.db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, payload_json, attempt_count, next_attempt_at, last_error
                 FROM queue_items
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
                 LIMIT ?1",
            )
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;

        let rows = stmt
            .query_map(params![limit as i64], map_row)
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| QueueStoreError::Db(e.to_string()))
    }

    pub fn mark_sent(&self, id: i64) -> Result<(), QueueStoreError> {
        let conn = open_db(&self.db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        conn.execute("DELETE FROM queue_items WHERE id = ?1", params![id])
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;
        Ok(())
    }

    pub fn mark_retry(
        &self,
        id: i64,
        attempts: i64,
        err: &str,
        retry_after_secs: Option<i64>,
    ) -> Result<(), QueueStoreError> {
        let conn = open_db(&self.db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        let now = now_unix();
        let next_attempt_count = attempts + 1;

        if next_attempt_count >= MAX_RETRY_ATTEMPTS {
            conn.execute(
                "UPDATE queue_items
                 SET status = 'failed', attempt_count = ?1, updated_at = ?2, last_error = ?3
                 WHERE id = ?4",
                params![next_attempt_count, now, err, id],
            )
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;
        } else {
            let next_attempt = now + retry_delay_seconds(next_attempt_count, retry_after_secs);
            conn.execute(
                "UPDATE queue_items
                 SET attempt_count = ?1, next_attempt_at = ?2, updated_at = ?3, last_error = ?4
                 WHERE id = ?5",
                params![next_attempt_count, next_attempt, now, err, id],
            )
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;
        }

        Ok(())
    }

    pub fn stats(&self) -> Result<QueueStats, QueueStoreError> {
        let conn = open_db(&self.db_path).map_err(|e| QueueStoreError::Db(e.to_string()))?;
        let pending = conn
            .query_row(
                "SELECT COUNT(*) FROM queue_items WHERE status = 'pending'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;

        let failed = conn
            .query_row(
                "SELECT COUNT(*) FROM queue_items WHERE status = 'failed' OR (status = 'pending' AND attempt_count > 0)",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| QueueStoreError::Db(e.to_string()))?;

        Ok(QueueStats {
            pending: pending as u64,
            failed: failed as u64,
        })
    }
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<QueueItem> {
    let payload_json: String = row.get(1)?;
    let payload = serde_json::from_str(&payload_json).unwrap_or(BookmarkPayload {
        url: String::new(),
        title: String::new(),
        notes: String::new(),
        tags: Vec::new(),
        private: false,
        read_later: false,
        intent: crate::domain::bookmark::SubmitIntent::Update,
    });

    Ok(QueueItem {
        id: row.get(0)?,
        payload,
        attempt_count: row.get(2)?,
        next_attempt_at: row.get(3)?,
        last_error: row.get(4)?,
    })
}

pub fn backoff_seconds(attempt: i64) -> i64 {
    match attempt {
        0 | 1 => 15,
        2 => 45,
        3 => 180,
        4 => 900,
        _ => 3600,
    }
}

pub fn retry_delay_seconds(attempt: i64, retry_after_override: Option<i64>) -> i64 {
    let base = backoff_seconds(attempt).max(MIN_QUEUE_DELAY_SECS);
    retry_after_override.unwrap_or(0).max(base)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{backoff_seconds, retry_delay_seconds};

    #[test]
    fn backoff_is_bounded() {
        assert_eq!(backoff_seconds(1), 15);
        assert_eq!(backoff_seconds(4), 900);
        assert_eq!(backoff_seconds(20), 3600);
    }

    #[test]
    fn retry_delay_respects_retry_after_override() {
        assert_eq!(retry_delay_seconds(1, Some(120)), 120);
        assert_eq!(retry_delay_seconds(3, Some(5)), 180);
    }
}
