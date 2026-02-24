use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::api::pinboard::PinboardError;
use crate::AppState;

const WORKER_TICK_SECS: u64 = 4;

pub async fn run_background_worker(app: AppHandle, state: Arc<AppState>) {
    loop {
        let _ = process_due_items(&app, &state, 1).await;
        tokio::time::sleep(Duration::from_secs(WORKER_TICK_SECS)).await;
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
                let retry_after = err.retry_after_secs();
                let should_break = matches!(err, PinboardError::RateLimited { .. });
                state
                    .queue_store
                    .mark_retry(
                        item.id,
                        item.attempt_count,
                        &err.message_for_user(),
                        retry_after,
                    )
                    .map_err(|e| e.to_string())?;
                let _ = app.emit("queue:item_failed", item.id);

                if should_break {
                    break;
                }
            }
        }
    }

    if let Ok(stats) = state.queue_store.stats() {
        let _ = app.emit("queue:stats_updated", stats);
    }

    Ok(sent)
}
