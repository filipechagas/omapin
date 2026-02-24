use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::AppState;

pub async fn run_background_worker(app: AppHandle, state: Arc<AppState>) {
    loop {
        let _ = process_due_items(&app, &state, 5).await;
        tokio::time::sleep(Duration::from_secs(20)).await;
    }
}

pub async fn process_due_items(
    app: &AppHandle,
    state: &Arc<AppState>,
    limit: usize,
) -> Result<usize, String> {
    let token = state
        .token_store
        .get_token()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pinboard token is not set".to_string())?;

    let due = state
        .queue_store
        .due_items(limit)
        .map_err(|e| e.to_string())?;
    let mut sent = 0usize;

    for item in due {
        match state.pinboard.add_bookmark(&token, &item.payload).await {
            Ok(_) => {
                state
                    .queue_store
                    .mark_sent(item.id)
                    .map_err(|e| e.to_string())?;
                let _ = app.emit("queue:item_sent", item.id);
                sent += 1;
            }
            Err(err) => {
                state
                    .queue_store
                    .mark_retry(item.id, item.attempt_count, &err.to_string())
                    .map_err(|e| e.to_string())?;
                let _ = app.emit("queue:item_failed", item.id);
            }
        }
    }

    if let Ok(stats) = state.queue_store.stats() {
        let _ = app.emit("queue:stats_updated", stats);
    }

    Ok(sent)
}
