import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  BookmarkPayload,
  ExistingBookmark,
  SubmitIntent,
  checkDuplicate,
  clearToken,
  fetchTagSuggestions,
  fetchUrlTitle,
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
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  const [intent, setIntent] = useState<SubmitIntent>("create");
  const [tokenInput, setTokenInput] = useState("");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [existingTagsLoaded, setExistingTagsLoaded] = useState(false);
  const [showTokenEditor, setShowTokenEditor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialClipboardLoading, setInitialClipboardLoading] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [tagsInputFocused, setTagsInputFocused] = useState(false);
  const [autocompleteDismissed, setAutocompleteDismissed] = useState(false);
  const [activeAutocompleteIndex, setActiveAutocompleteIndex] = useState(0);
  const inspectRequestRef = useRef(0);
  const lastInspectedUrlRef = useRef("");
  const focusTitleAfterInspectRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const clipboardPrefillInFlightRef = useRef(false);
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
    reset,
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

  const urlField = register("url");
  const titleField = register("title");

  const getCurrentTags = () =>
    getValues("tags")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter(Boolean);

  const resetBookmarkForm = () => {
    reset({
      url: "",
      title: "",
      notes: "",
      tags: "",
      private: false,
      readLater: false,
    });
    setIntent("create");
    setDuplicate(undefined);
    setSuggestions(undefined);
    lastInspectedUrlRef.current = "";
  };

  const applyExistingBookmark = (bookmark: ExistingBookmark, fallbackUrl: string) => {
    setValue("url", bookmark.url || fallbackUrl, { shouldDirty: true });
    setValue("title", bookmark.title, { shouldDirty: true });
    setValue("notes", bookmark.notes, { shouldDirty: true });
    setValue("tags", bookmark.tags.join(" "), { shouldDirty: true });
    setValue("private", bookmark.private, { shouldDirty: true });
    setValue("readLater", bookmark.readLater, { shouldDirty: true });
    setIntent("update");
  };

  const findTagAutocompleteSuggestions = (input: string) => {
    if (!input.trim() || /\s$/.test(input)) {
      return [];
    }

    const parts = input.split(/\s+/);
    const partial = parts[parts.length - 1]?.trim();
    if (!partial) {
      return [];
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

    return suggestionPool
      .filter((tag) => {
        const normalized = tag.trim();
        const normalizedLower = normalized.toLowerCase();
        return (
          normalizedLower.startsWith(partialLower) &&
          normalizedLower !== partialLower &&
          !existing.has(normalizedLower)
        );
      })
      .slice(0, 8);
  };

  const inspectUrl = async (rawUrl: string, options?: { focusTitleAfterInspect?: boolean }) => {
    const focusTitleAfterInspect = options?.focusTitleAfterInspect ?? false;
    const requestId = inspectRequestRef.current + 1;
    inspectRequestRef.current = requestId;
    setInspectLoading(true);

    const url = rawUrl.trim();
    if (!url || !startsLikeUrl(url)) {
      lastInspectedUrlRef.current = "";
      if (requestId === inspectRequestRef.current) {
        setDuplicate(undefined);
        setSuggestions(undefined);
        if (!url) {
          setValue("title", "", { shouldDirty: true });
          setValue("notes", "", { shouldDirty: true });
          setValue("tags", "", { shouldDirty: true });
        }
        setInspectLoading(false);
        if (focusTitleAfterInspect) {
          window.requestAnimationFrame(() => {
            titleInputRef.current?.focus();
          });
        }
      }
      return;
    }

    lastInspectedUrlRef.current = url;

    const titleBeforeInspect = getValues("title").trim();

    const [dedupeResult, tagsResult, titleResult] = await Promise.allSettled([
      tokenConfigured ? checkDuplicate(url) : Promise.resolve(undefined),
      tokenConfigured ? fetchTagSuggestions(url) : Promise.resolve(undefined),
      fetchUrlTitle(url),
    ]);

    let loadedExistingBookmark = false;

    if (requestId !== inspectRequestRef.current) {
      return;
    }

    if (dedupeResult.status === "fulfilled" && dedupeResult.value) {
      setDuplicate(dedupeResult.value);
      if (dedupeResult.value.exists && dedupeResult.value.bookmark) {
        applyExistingBookmark(dedupeResult.value.bookmark, url);
        loadedExistingBookmark = true;
      } else {
        setIntent("create");
      }
    } else if (dedupeResult.status === "rejected") {
      setDuplicate(undefined);
      setStatusMessage(`Could not check duplicate URL yet: ${String(dedupeResult.reason)}`);
    }

    if (tagsResult.status === "fulfilled") {
      setSuggestions(tagsResult.value);
    } else if (tagsResult.status === "rejected") {
      setSuggestions(undefined);
      setStatusMessage(`Could not load suggestions yet: ${String(tagsResult.reason)}`);
    }

    if (!loadedExistingBookmark && titleResult.status === "fulfilled") {
      const fetchedTitle = titleResult.value?.trim();
      if (fetchedTitle && !titleBeforeInspect) {
        setValue("title", fetchedTitle, { shouldDirty: true });
      }
    }

    if (requestId === inspectRequestRef.current) {
      setInspectLoading(false);
      if (focusTitleAfterInspect) {
        window.requestAnimationFrame(() => {
          titleInputRef.current?.focus();
        });
      }
    }
  };

  const tryPrefillFromClipboard = async () => {
    if (getValues("url").trim() || clipboardPrefillInFlightRef.current) {
      return;
    }

    clipboardPrefillInFlightRef.current = true;

    try {
      const text = (await readText()).trim();
      if (text && startsLikeUrl(text)) {
        setInitialClipboardLoading(true);
        setValue("url", text, { shouldDirty: true });
        await inspectUrl(text);
      }
    } catch {
      // Clipboard can fail on some setups; manual paste remains available.
    } finally {
      setInitialClipboardLoading(false);
      clipboardPrefillInFlightRef.current = false;
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
    if (
      !tokenConfigured ||
      existingTagsLoaded ||
      inspectLoading ||
      initialClipboardLoading ||
      clipboardPrefillInFlightRef.current
    ) {
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
  }, [existingTagsLoaded, tokenConfigured, inspectLoading, initialClipboardLoading]);

  useEffect(() => {
    const onFocus = () => {
      void tryPrefillFromClipboard();
    };

    void tryPrefillFromClipboard();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [getValues, setValue, tokenConfigured]);

  const onUrlBlur = async () => {
    if (initialClipboardLoading) {
      return;
    }

    const focusTitleAfterInspect = focusTitleAfterInspectRef.current;
    focusTitleAfterInspectRef.current = false;
    const currentUrl = getValues("url").trim();

    if (currentUrl === lastInspectedUrlRef.current) {
      return;
    }

    await inspectUrl(currentUrl, { focusTitleAfterInspect });
  };

  const onUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    focusTitleAfterInspectRef.current =
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
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

  const autocompleteTag = (match: string | null | undefined) => {
    if (!match) {
      return false;
    }

    const current = getValues("tags");
    const parts = current.split(/\s+/);
    parts[parts.length - 1] = match;
    setValue("tags", `${parts.join(" ")} `, { shouldDirty: true });
    return true;
  };

  const onTagsKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && showTagAutocomplete) {
      event.preventDefault();
      event.stopPropagation();
      setAutocompleteDismissed(true);
      return;
    }

    const autocompleteCount = showTagAutocomplete ? tagAutocompleteOptions.length : 0;
    if (!autocompleteCount) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveAutocompleteIndex((index) => (index + 1) % autocompleteCount);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveAutocompleteIndex((index) => (index - 1 + autocompleteCount) % autocompleteCount);
      return;
    }

    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key !== "Tab" && event.key !== "Enter") {
      return;
    }

    const activeMatch = tagAutocompleteOptions[activeAutocompleteIndex] ?? tagAutocompleteOptions[0];
    if (autocompleteTag(activeMatch)) {
      event.preventDefault();
    }
  };

  const tagsInputValue = watch("tags");
  const tagAutocompleteOptions = findTagAutocompleteSuggestions(tagsInputValue ?? "");
  const showTagAutocomplete = tagsInputFocused && !autocompleteDismissed && tagAutocompleteOptions.length > 0;
  const queuedFailures = queue.filter((item) => item.attemptCount > 0).length;

  useEffect(() => {
    setActiveAutocompleteIndex(0);
    setAutocompleteDismissed(false);
  }, [tagsInputValue]);

  useEffect(() => {
    if (activeAutocompleteIndex < tagAutocompleteOptions.length) {
      return;
    }
    setActiveAutocompleteIndex(0);
  }, [activeAutocompleteIndex, tagAutocompleteOptions.length]);

  const useExistingDuplicate = () => {
    if (!duplicate?.bookmark) {
      return;
    }

    applyExistingBookmark(duplicate.bookmark, getValues("url").trim() || duplicate.bookmark.url);
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

      if (!result.queued) {
        resetBookmarkForm();
        try {
          await getCurrentWindow().close();
        } catch {
          await getCurrentWindow().hide();
        }
        return;
      }

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
      resetBookmarkForm();
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
  const formLocked = submitting || inspectLoading || initialClipboardLoading;
  const showSkeleton = tokenConfigured && (initialClipboardLoading || inspectLoading);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="title-block">
          <p className="app-path">~/omarchy/quick-add</p>
          <h1>ommapin</h1>
          <p className="app-subtitle">Pinboard capture tuned for a keyboard-first Linux workflow.</p>
        </div>
        <div className="header-controls">
          <div className="session-strip" role="status" aria-label="session status">
            <span>
              <kbd>Esc</kbd> hide
            </span>
            <span>queue {queue.length}</span>
            <span>failed {queuedFailures}</span>
            <span>mode {intent}</span>
          </div>
          {tokenConfigured ? (
            <button type="button" onClick={() => setShowTokenEditor((value) => !value)}>
              {showTokenEditor ? "Close settings" : "Settings"}
            </button>
          ) : null}
        </div>
      </header>

      {shouldShowTokenPanel ? (
        <section className="token-panel">
          <div className="panel-title-row">
            <strong>Auth // Pinboard token</strong>
            <span className={`panel-badge ${tokenConfigured ? "ok" : "warn"}`}>
              {tokenConfigured ? "configured" : "missing"}
            </span>
          </div>
          <p>
            {tokenConfigured
              ? "Update your token or log out. Credentials stay in your system keyring."
              : "Token is required before quick add is enabled."}
          </p>
          <label className="token-label">
            token
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="username:TOKEN"
            />
          </label>
          <div className="token-actions">
            <button type="button" className="button-primary" onClick={() => void persistToken()}>
              Save token
            </button>
            {tokenConfigured ? (
              <button type="button" className="button-danger" onClick={() => void removeToken()}>
                Logout
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {tokenConfigured ? (
        <>
          {showSkeleton ? (
            <section className="bookmark-skeleton" aria-live="polite" aria-busy="true">
              <div className="skeleton-line skeleton-line-title" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line-block" />
              <div className="skeleton-line" />
              <p>Inspecting URL, loading title, and pulling Pinboard metadata...</p>
            </section>
          ) : (
            <>
              <form className="bookmark-form" onSubmit={handleSubmit(onSubmit)}>
                <fieldset className="bookmark-fieldset" disabled={formLocked}>
                  <label>
                    <span className="field-label">[url]</span>
                    <input
                      {...urlField}
                      placeholder="https://news.ycombinator.com"
                      onKeyDown={onUrlKeyDown}
                      onBlur={() => void onUrlBlur()}
                    />
                    {errors.url ? <small>{errors.url.message}</small> : null}
                  </label>

                  <label>
                    <span className="field-label">[title]</span>
                    <input
                      {...titleField}
                      ref={(element) => {
                        titleField.ref(element);
                        titleInputRef.current = element;
                      }}
                      placeholder="Hacker News"
                    />
                    {errors.title ? <small>{errors.title.message}</small> : null}
                  </label>

                  <label>
                    <span className="field-label">[notes]</span>
                    <textarea {...register("notes")} rows={4} placeholder="Optional notes" />
                  </label>

                  <label>
                    <span className="field-label">[tags]</span>
                    <div className="autocomplete-field">
                      <input
                        {...register("tags")}
                        placeholder="tech news rust"
                        onKeyDown={onTagsKeyDown}
                        onFocus={() => {
                          setTagsInputFocused(true);
                          setAutocompleteDismissed(false);
                        }}
                        onBlur={() => {
                          setTagsInputFocused(false);
                          setAutocompleteDismissed(false);
                        }}
                        aria-autocomplete="list"
                        aria-expanded={showTagAutocomplete}
                        aria-controls="tags-autocomplete-list"
                      />
                      {showTagAutocomplete ? (
                        <ul className="autocomplete-menu" id="tags-autocomplete-list" role="listbox">
                          {tagAutocompleteOptions.map((tag, index) => {
                            const selected = index === activeAutocompleteIndex;
                            return (
                              <li key={tag} role="option" aria-selected={selected}>
                                <button
                                  type="button"
                                  className={`autocomplete-option${selected ? " is-active" : ""}`}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onMouseEnter={() => setActiveAutocompleteIndex(index)}
                                  onClick={() => autocompleteTag(tag)}
                                >
                                  <span>{tag}</span>
                                  {selected ? <kbd>Tab</kbd> : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  </label>

                  <DedupeBanner
                    duplicate={duplicate}
                    onUseExisting={useExistingDuplicate}
                    onUpdate={() => setIntent("update")}
                    onCreateNew={() => setIntent("create")}
                  />

                  <TagSuggestions suggestions={suggestions} onAddTag={appendTag} onAddAll={addAllSuggested} />

                  <div className="boolean-row">
                    <label className="toggle-option">
                      <input type="checkbox" {...register("private")} />
                      <span>private</span>
                    </label>
                    <label className="toggle-option">
                      <input type="checkbox" {...register("readLater")} />
                      <span>read later</span>
                    </label>
                  </div>

                  <div className="submit-row">
                    <button type="submit" className="button-primary" disabled={formLocked || !tokenConfigured}>
                      {submitting ? "Saving..." : "Write bookmark"}
                    </button>
                    <span className="intent-pill">intent {intent === "update" ? ":: update" : ":: create"}</span>
                  </div>
                </fieldset>
              </form>

              <QueueStatus queue={queue} onRetry={retryNow} />
            </>
          )}
        </>
      ) : null}

      {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
    </main>
  );
}
