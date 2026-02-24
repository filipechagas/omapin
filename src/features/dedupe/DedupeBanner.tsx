import { DuplicateCheckResult } from "../../lib/tauri";

interface DedupeBannerProps {
  duplicate?: DuplicateCheckResult;
  onUseExisting: () => void;
  onUpdate: () => void;
  onCreateNew: () => void;
}

export function DedupeBanner({
  duplicate,
  onUseExisting,
  onUpdate,
  onCreateNew,
}: DedupeBannerProps) {
  if (!duplicate?.exists || !duplicate.bookmark) {
    return null;
  }

  return (
    <section className="dedupe-banner">
      <p>
        Duplicate found for this URL: <strong>{duplicate.bookmark.title || duplicate.bookmark.url}</strong>
      </p>
      <div className="dedupe-actions">
        <button type="button" onClick={onUseExisting}>
          Load existing
        </button>
        <button type="button" onClick={onUpdate}>
          Keep update mode
        </button>
        <button type="button" onClick={onCreateNew}>
          Force create
        </button>
      </div>
    </section>
  );
}
