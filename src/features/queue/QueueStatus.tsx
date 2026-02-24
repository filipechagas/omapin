import { QueueItem } from "../../lib/tauri";

interface QueueStatusProps {
  queue: QueueItem[];
  onRetry: () => Promise<void>;
}

export function QueueStatus({ queue, onRetry }: QueueStatusProps) {
  if (queue.length === 0) {
    return <p className="queue-empty">Queue empty. Offline buffer is clear.</p>;
  }

  return (
    <section className="queue-status">
      <div className="queue-header">
        <strong>queue::{queue.length}</strong>
        <button type="button" onClick={() => void onRetry()}>
          Retry now
        </button>
      </div>
      <ul>
        {queue.slice(0, 5).map((item, index) => (
          <li key={item.id}>
            <span className="queue-item-title">
              [{String(index + 1).padStart(2, "0")}] {item.payload.title || item.payload.url}
            </span>
            <span className="queue-item-meta">
              attempts {item.attemptCount}
              {item.lastError ? <em>{item.lastError}</em> : <em>waiting for next sync</em>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
