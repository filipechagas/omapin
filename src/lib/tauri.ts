import { invoke } from "@tauri-apps/api/core";

export type SubmitIntent = "create" | "update";

export interface BookmarkPayload {
  url: string;
  title: string;
  notes: string;
  tags: string[];
  private: boolean;
  readLater: boolean;
  intent: SubmitIntent;
}

export interface ExistingBookmark {
  url: string;
  title: string;
  notes: string;
  tags: string[];
  private: boolean;
  readLater: boolean;
  time: string;
}

export interface DuplicateCheckResult {
  exists: boolean;
  bookmark?: ExistingBookmark;
}

export interface TagSuggestions {
  popular: string[];
  recommended: string[];
}

export interface QueueStats {
  pending: number;
  failed: number;
}

export interface SessionInfo {
  tokenConfigured: boolean;
  queueStats: QueueStats;
}

export interface SubmitResult {
  status: string;
  message: string;
  queued: boolean;
}

export interface QueueItem {
  id: number;
  payload: BookmarkPayload;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface QueueRetryResult {
  sent: number;
  remaining: number;
}

export const initSession = () => invoke<SessionInfo>("init_session");
export const saveToken = (token: string) => invoke<void>("save_token", { token });
export const clearToken = () => invoke<void>("clear_token");
export const checkDuplicate = (url: string) =>
  invoke<DuplicateCheckResult>("check_duplicate", { url });
export const fetchTagSuggestions = (url: string) =>
  invoke<TagSuggestions>("fetch_tag_suggestions", { url });
export const submitBookmark = (payload: BookmarkPayload) =>
  invoke<SubmitResult>("submit_bookmark", { payload });
export const getQueue = () => invoke<QueueItem[]>("queue_list");
export const retryQueueNow = () => invoke<QueueRetryResult>("queue_retry_now");
