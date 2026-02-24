# ommapin architecture

## components
- Frontend (`src/`): quick-add form, dedupe UI, tag suggestion chips, queue status.
- Tauri commands (`src-tauri/src/app/commands.rs`): API boundary between UI and Rust logic.
- Pinboard API client (`src-tauri/src/api/pinboard.rs`): authenticated requests with rate pacing.
- Queue store (`src-tauri/src/queue/store.rs`): SQLite persistence for failed submissions.
- Queue worker (`src-tauri/src/queue/worker.rs`): periodic retry loop and status events.
- Token storage (`src-tauri/src/security/token_store.rs`): Linux keyring backed secret management.

## request flow
1. User opens quick-add window from Omarchy keybind.
2. URL is pasted or prefilled from clipboard.
3. UI requests duplicate check and tag suggestions.
4. Submit sends bookmark to Pinboard (`posts/add`).
5. On failure, payload is queued in SQLite and retried in background.

## queue semantics
- Table: `queue_items` in `~/.local/share/ommapin/ommapin.db`.
- Retry backoff: 10s -> 30s -> 2m -> 10m -> 1h cap.
- Manual retry command is available from UI.
