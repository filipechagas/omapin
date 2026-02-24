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

  useEffect(() => {
    if (!tokenConfigured) {
      setShowTokenEditor(true);
    }
  }, [tokenConfigured]);

  useEffect(() => {
    const preloadClipboard = async () => {
      try {
        const text = (await readText()).trim();
        if (text && startsLikeUrl(text) && !getValues("url")) {
          setValue("url", text, { shouldDirty: true });
        }
      } catch {
        // Clipboard can fail on some setups; manual paste remains available.
      }
    };

    void preloadClipboard();
  }, [getValues, setValue]);

  const onUrlBlur = async () => {
    const url = getValues("url").trim();
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
              <input {...register("tags")} placeholder="tech news rust" />
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
