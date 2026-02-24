import { QueueItem } from "../../lib/tauri";

interface QueueStatusProps {
  queue: QueueItem[];
  onRetry: () => Promise<void>;
}

export function QueueStatus({ queue, onRetry }: QueueStatusProps) {
  if (queue.length === 0) {
    return <p className="queue-empty">Queue empty</p>;
  }

  return (
    <section className="queue-status">
      <div className="queue-header">
        <strong>{queue.length}</strong> queued item(s)
        <button type="button" onClick={() => void onRetry()}>
          Retry now
        </button>
      </div>
      <ul>
        {queue.slice(0, 5).map((item) => (
          <li key={item.id}>
            <span>{item.payload.title || item.payload.url}</span>
            {item.lastError ? <em>{item.lastError}</em> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
