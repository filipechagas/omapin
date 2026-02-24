import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  BookmarkPayload,
  SubmitIntent,
  checkDuplicate,
  clearToken,
  fetchTagSuggestions,
  fetchUserTags,
  retryQueueNow,
  saveToken,
  submitBookmark,
} from "../../lib/tauri";
import { DedupeBanner } from "../dedupe/DedupeBanner";
import { QueueStatus } from "../queue/QueueStatus";
import { TagSuggestions } from "../tags/TagSuggestions";
import { useBookmarkStore } from "../../state/useBookmarkStore";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

const startsLikeUrl = (value: string) => /^https?:\/\//.test(value) || value.includes(".");

const schema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .refine((value) => startsLikeUrl(value.trim()), "Enter a valid URL"),
  title: z.string().min(1, "Title is required").max(255),
  notes: z.string().max(65536).optional(),
  tags: z.string(),
  private: z.boolean(),
  readLater: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function QuickAddForm() {
  const [intent, setIntent] = useState<SubmitIntent>("update");
  const [tokenInput, setTokenInput] = useState("");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [existingTagsLoaded, setExistingTagsLoaded] = useState(false);
  const [showTokenEditor, setShowTokenEditor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const {
    tokenConfigured,
    duplicate,
    suggestions,
    queue,
    statusMessage,
    setDuplicate,
    setSuggestions,
    setStatusMessage,
    setTokenConfigured,
    refreshQueue,
  } = useBookmarkStore();

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      url: "",
      title: "",
      notes: "",
      tags: "",
      private: false,
      readLater: false,
    },
  });

  const getCurrentTags = () =>
    getValues("tags")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter(Boolean);

  const findTagAutocompleteSuggestion = (input: string) => {
    if (!input.trim() || /\s$/.test(input)) {
      return null;
    }

    const parts = input.split(/\s+/);
    const partial = parts[parts.length - 1]?.trim();
    if (!partial) {
      return null;
    }

    const partialLower = partial.toLowerCase();
    const existing = new Set(parts.slice(0, -1).map((tag) => tag.toLowerCase()));

    const suggestionPool = Array.from(
      new Map(
        [...(suggestions?.recommended ?? []), ...(suggestions?.popular ?? []), ...existingTags].map((tag) => [
          tag.toLowerCase(),
          tag,
        ]),
      ).values(),
    );

    return (
      suggestionPool.find((tag) => {
        const normalized = tag.trim();
        const normalizedLower = normalized.toLowerCase();
        return (
          normalizedLower.startsWith(partialLower) &&
          normalizedLower !== partialLower &&
          !existing.has(normalizedLower)
        );
      }) ?? null
    );
  };

  const inspectUrl = async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url || !startsLikeUrl(url)) {
      setDuplicate(undefined);
      setSuggestions(undefined);
      return;
    }

    if (!tokenConfigured) {
      return;
    }

    try {
      const [dedupe, tags] = await Promise.all([checkDuplicate(url), fetchTagSuggestions(url)]);
      setDuplicate(dedupe);
      setSuggestions(tags);
    } catch (error) {
      setStatusMessage(`Could not inspect URL yet: ${String(error)}`);
    }
  };

  const tryPrefillFromClipboard = async () => {
    if (getValues("url").trim()) {
      return;
    }

    try {
      const text = (await readText()).trim();
      if (text && startsLikeUrl(text)) {
        setValue("url", text, { shouldDirty: true });
        await inspectUrl(text);
      }
    } catch {
      // Clipboard can fail on some setups; manual paste remains available.
    }
  };

  useEffect(() => {
    if (!tokenConfigured) {
      setShowTokenEditor(true);
      setExistingTags([]);
      setExistingTagsLoaded(false);
    }
  }, [tokenConfigured]);

  useEffect(() => {
    if (!tokenConfigured || existingTagsLoaded) {
      return;
    }

    const loadExistingTags = async () => {
      try {
        const tags = await fetchUserTags();
        setExistingTags(tags);
        setExistingTagsLoaded(true);
      } catch {
        // keep non-blocking; autocomplete still works from URL-specific suggestions
      }
    };

    void loadExistingTags();
  }, [existingTagsLoaded, tokenConfigured]);

  useEffect(() => {
    const onFocus = () => {
      void tryPrefillFromClipboard();
    };

    void tryPrefillFromClipboard();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [getValues, setValue]);

  const onUrlBlur = async () => {
    await inspectUrl(getValues("url"));
  };

  const appendTag = (tag: string) => {
    const tagArray = getCurrentTags();
    const merged = Array.from(new Set([...tagArray.map((t) => t.toLowerCase()), tag.toLowerCase()]));
    const sourceMap = new Map<string, string>();
    [...tagArray, tag].forEach((item) => sourceMap.set(item.toLowerCase(), item));
    setValue(
      "tags",
      merged
        .map((key) => sourceMap.get(key) || key)
        .join(" ")
        .trim(),
      { shouldDirty: true },
    );
  };

  const addAllSuggested = () => {
    if (!suggestions) {
      return;
    }

    const existing = getCurrentTags();
    const tagMap = new Map<string, string>();
    [...existing, ...suggestions.recommended, ...suggestions.popular].forEach((item) => {
      const key = item.toLowerCase();
      if (!tagMap.has(key)) {
        tagMap.set(key, item);
      }
    });
    setValue("tags", Array.from(tagMap.values()).join(" "), { shouldDirty: true });
  };

  const tryAutocompleteTag = () => {
    const current = getValues("tags");
    const match = findTagAutocompleteSuggestion(current);
    if (!match) {
      return false;
    }

    const parts = current.split(/\s+/);
    parts[parts.length - 1] = match;
    setValue("tags", `${parts.join(" ")} `, { shouldDirty: true });
    return true;
  };

  const onTagsKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key !== "Tab" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    if (tryAutocompleteTag()) {
      event.preventDefault();
    }
  };

  const tagsInputValue = watch("tags");
  const tabCompletionHint = findTagAutocompleteSuggestion(tagsInputValue ?? "");

  const applyExisting = () => {
    if (!duplicate?.bookmark) {
      return;
    }
    setValue("title", duplicate.bookmark.title);
    setValue("notes", duplicate.bookmark.notes);
    setValue("tags", duplicate.bookmark.tags.join(" "));
    setValue("private", duplicate.bookmark.private);
    setValue("readLater", duplicate.bookmark.readLater);
    setIntent("update");
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const payload: BookmarkPayload = {
        url: values.url,
        title: values.title,
        notes: values.notes || "",
        tags: values.tags.split(/\s+/).filter(Boolean),
        private: values.private,
        readLater: values.readLater,
        intent,
      };

      const result = await submitBookmark(payload);
      setStatusMessage(result.message);
      await refreshQueue();
    } catch (error) {
      setStatusMessage(`Save failed: ${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const persistToken = async () => {
    if (!tokenInput.trim()) {
      setStatusMessage("Enter your Pinboard token in username:TOKEN format.");
      return;
    }

    try {
      await saveToken(tokenInput.trim());
      setTokenConfigured(true);
      setExistingTagsLoaded(false);
      setTokenInput("");
      setShowTokenEditor(false);
      setStatusMessage("Token saved in system keyring.");
    } catch (error) {
      setStatusMessage(`Failed to save token: ${String(error)}`);
    }
  };

  const removeToken = async () => {
    try {
      await clearToken();
      setTokenConfigured(false);
      setDuplicate(undefined);
      setSuggestions(undefined);
      setStatusMessage("Pinboard token cleared.");
    } catch (error) {
      setStatusMessage(`Failed to clear token: ${String(error)}`);
    }
  };

  const retryNow = async () => {
    const result = await retryQueueNow();
    setStatusMessage(`Retried queue: sent ${result.sent}, remaining ${result.remaining}`);
    await refreshQueue();
  };

  const shouldShowTokenPanel = !tokenConfigured || showTokenEditor;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>ommapin</h1>
          <p>Quick save to Pinboard from your Omarchy workflow.</p>
        </div>
        {tokenConfigured ? (
          <button type="button" onClick={() => setShowTokenEditor((value) => !value)}>
            {showTokenEditor ? "Close settings" : "Settings"}
          </button>
        ) : null}
      </header>

      {shouldShowTokenPanel ? (
        <section className="token-panel">
          <div>
            <strong>Pinboard token</strong>
            <p>
              {tokenConfigured
                ? "Update your token or log out."
                : "Token is required before quick add is enabled."}
            </p>
          </div>
          <div className="token-actions">
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="username:TOKEN"
            />
            <button type="button" onClick={() => void persistToken()}>
              Save token
            </button>
            {tokenConfigured ? (
              <button type="button" onClick={() => void removeToken()}>
                Logout
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {tokenConfigured ? (
        <>
          <DedupeBanner
            duplicate={duplicate}
            onUseExisting={applyExisting}
            onUpdate={() => setIntent("update")}
            onCreateNew={() => setIntent("create")}
          />

          <form className="bookmark-form" onSubmit={handleSubmit(onSubmit)}>
            <label>
              URL
              <input
                {...register("url")}
                placeholder="https://news.ycombinator.com"
                onBlur={() => void onUrlBlur()}
              />
              {errors.url ? <small>{errors.url.message}</small> : null}
            </label>

            <label>
              Title
              <input {...register("title")} placeholder="Hacker News" />
              {errors.title ? <small>{errors.title.message}</small> : null}
            </label>

            <label>
              Notes
              <textarea {...register("notes")} rows={4} placeholder="Optional notes" />
            </label>

            <label>
              Tags
              <input {...register("tags")} placeholder="tech news rust" onKeyDown={onTagsKeyDown} />
              {tabCompletionHint ? (
                <span className="autocomplete-hint">
                  Press <kbd>Tab</kbd> to complete <strong>{tabCompletionHint}</strong>
                </span>
              ) : null}
            </label>

            <TagSuggestions suggestions={suggestions} onAddTag={appendTag} onAddAll={addAllSuggested} />

            <div className="boolean-row">
              <label>
                <input type="checkbox" {...register("private")} /> private
              </label>
              <label>
                <input type="checkbox" {...register("readLater")} /> read later
              </label>
            </div>

            <div className="submit-row">
              <button type="submit" disabled={submitting || !tokenConfigured}>
                {submitting ? "Saving..." : "Submit"}
              </button>
              <span className="intent-pill">intent: {intent}</span>
            </div>
          </form>

          <QueueStatus queue={queue} onRetry={retryNow} />
        </>
      ) : null}

      {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
    </main>
  );
}
