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
        Existing bookmark found: <strong>{duplicate.bookmark.title || duplicate.bookmark.url}</strong>
      </p>
      <div className="dedupe-actions">
        <button type="button" onClick={onUseExisting}>
          Use existing data
        </button>
        <button type="button" onClick={onUpdate}>
          Update existing
        </button>
        <button type="button" onClick={onCreateNew}>
          Create new
        </button>
      </div>
    </section>
  );
}
