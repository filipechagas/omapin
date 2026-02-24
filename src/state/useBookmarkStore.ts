import { create } from "zustand";
import {
  DuplicateCheckResult,
  QueueItem,
  QueueStats,
  SessionInfo,
  TagSuggestions,
  getQueue,
  initSession,
} from "../lib/tauri";

interface BookmarkState {
  loading: boolean;
  tokenConfigured: boolean;
  queueStats: QueueStats;
  queue: QueueItem[];
  duplicate?: DuplicateCheckResult;
  suggestions?: TagSuggestions;
  statusMessage: string;
  hydrate: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  setTokenConfigured: (configured: boolean) => void;
  setDuplicate: (duplicate?: DuplicateCheckResult) => void;
  setSuggestions: (suggestions?: TagSuggestions) => void;
  setStatusMessage: (message: string) => void;
}

const defaultQueueStats: QueueStats = { pending: 0, failed: 0 };

export const useBookmarkStore = create<BookmarkState>((set) => ({
  loading: true,
  tokenConfigured: false,
  queueStats: defaultQueueStats,
  queue: [],
  statusMessage: "",
  hydrate: async () => {
    set({ loading: true });
    try {
      const session: SessionInfo = await initSession();
      const queue = await getQueue();
      set({
        loading: false,
        tokenConfigured: session.tokenConfigured,
        queueStats: session.queueStats,
        queue,
      });
    } catch (error) {
      set({
        loading: false,
        statusMessage: `Failed to initialize app: ${String(error)}`,
      });
    }
  },
  refreshQueue: async () => {
    const queue = await getQueue();
    set({ queue, queueStats: { pending: queue.length, failed: queue.filter((i) => i.attemptCount > 0).length } });
  },
  setTokenConfigured: (tokenConfigured) => set({ tokenConfigured }),
  setDuplicate: (duplicate) => set({ duplicate }),
  setSuggestions: (suggestions) => set({ suggestions }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
