import { TagSuggestions as TagSuggestionModel } from "../../lib/tauri";

interface TagSuggestionsProps {
  suggestions?: TagSuggestionModel;
  onAddTag: (tag: string) => void;
  onAddAll: () => void;
}

export function TagSuggestions({ suggestions, onAddTag, onAddAll }: TagSuggestionsProps) {
  if (!suggestions) {
    return null;
  }

  const tags = Array.from(
    new Map(
      [...suggestions.recommended, ...suggestions.popular].map((tag) => [tag.toLowerCase(), tag]),
    ).values(),
  );

  if (tags.length === 0) {
    return null;
  }

  return (
    <section className="tag-suggestions">
      <div className="tag-suggestions-title">Suggest</div>
      <div className="tag-list">
        {tags.map((tag) => (
          <button key={tag} type="button" className="tag-chip" onClick={() => onAddTag(tag)}>
            {tag}
          </button>
        ))}
        <button type="button" className="tag-add-all" onClick={onAddAll}>
          Add all
        </button>
      </div>
    </section>
  );
}
