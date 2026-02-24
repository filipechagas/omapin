import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { QuickAddForm } from "./features/quick-add/QuickAddForm";
import { useBookmarkStore } from "./state/useBookmarkStore";

function App() {
  const { hydrate, loading, refreshQueue } = useBookmarkStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const unlistenSent = await listen("queue:item_sent", () => {
        if (!cancelled) {
          void refreshQueue();
        }
      });
      const unlistenFailed = await listen("queue:item_failed", () => {
        if (!cancelled) {
          void refreshQueue();
        }
      });

      return () => {
        unlistenSent();
        unlistenFailed();
      };
    };

    let cleanup: (() => void) | undefined;
    void setup().then((dispose) => {
      cleanup = dispose;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [refreshQueue]);

  if (loading) {
    return <main className="app-shell loading">Loading ommapin...</main>;
  }

  return <QuickAddForm />;
}

export default App;
