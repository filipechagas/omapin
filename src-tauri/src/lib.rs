mod api;
mod app;
mod dedupe;
mod domain;
mod infra;
mod queue;
mod security;

use std::sync::Arc;

use api::pinboard::PinboardClient;
use app::commands::{
    check_duplicate, clear_token, fetch_tag_suggestions, fetch_user_tags, init_session, queue_list,
    queue_retry_now, save_token, submit_bookmark,
};
use queue::store::QueueStore;
use security::token_store::TokenStore;
use tauri::{Manager, WebviewWindowBuilder};

pub struct AppState {
    pub token_store: TokenStore,
    pub pinboard: PinboardClient,
    pub queue_store: QueueStore,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let queue_store = QueueStore::new("").expect("failed to initialize queue store");
    let state = Arc::new(AppState {
        token_store: TokenStore::new(),
        pinboard: PinboardClient::new(),
        queue_store,
    });

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            } else {
                let _ = WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                    .title("ommapin")
                    .inner_size(620.0, 560.0)
                    .resizable(true)
                    .build();
            }
        }))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<Arc<AppState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                queue::worker::run_background_worker(app_handle, state).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_session,
            save_token,
            clear_token,
            fetch_tag_suggestions,
            fetch_user_tags,
            check_duplicate,
            submit_bookmark,
            queue_list,
            queue_retry_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ommapin");
}
