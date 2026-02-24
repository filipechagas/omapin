import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { QuickAddForm } from "./features/quick-add/QuickAddForm";
import { getOmarchyTheme, OmarchyTheme } from "./lib/tauri";
import { useBookmarkStore } from "./state/useBookmarkStore";

const THEME_POLL_INTERVAL_MS = 2500;
const HEX_COLOR_PATTERN = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

const normalizeHexColor = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return null;
  }

  return `#${normalized.slice(1, 7).toLowerCase()}`;
};

const hexToRgb = (hex: string) => {
  const clean = hex.slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
};

const toHex = (value: { r: number; g: number; b: number }) => {
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)));
  const parts = [clamp(value.r), clamp(value.g), clamp(value.b)].map((channel) =>
    channel.toString(16).padStart(2, "0"),
  );
  return `#${parts.join("")}`;
};

const mixColors = (base: string, overlay: string, overlayWeight: number) => {
  const baseRgb = hexToRgb(base);
  const overlayRgb = hexToRgb(overlay);
  const ratio = Math.max(0, Math.min(1, overlayWeight));

  return toHex({
    r: baseRgb.r + (overlayRgb.r - baseRgb.r) * ratio,
    g: baseRgb.g + (overlayRgb.g - baseRgb.g) * ratio,
    b: baseRgb.b + (overlayRgb.b - baseRgb.b) * ratio,
  });
};

const withAlpha = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped.toFixed(2)})`;
};

const escapeCssString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const applyOmarchyTheme = (theme: OmarchyTheme) => {
  const background = normalizeHexColor(theme.colors.background) ?? "#0a0f0c";
  const foreground = normalizeHexColor(theme.colors.foreground) ?? "#d9eadf";
  const accent =
    normalizeHexColor(theme.colors.accent) ??
    normalizeHexColor(theme.colors.color4) ??
    mixColors(foreground, background, 0.18);
  const warning = normalizeHexColor(theme.colors.color3) ?? "#f3c47a";
  const danger = normalizeHexColor(theme.colors.color1) ?? "#f28d80";
  const line = normalizeHexColor(theme.colors.color8) ?? mixColors(background, foreground, 0.22);
  const lineStrong = normalizeHexColor(theme.colors.color7) ?? mixColors(background, foreground, 0.34);
  const muted = mixColors(foreground, background, 0.38);
  const accentStrong = normalizeHexColor(theme.colors.color12) ?? accent;
  const accentAlt =
    normalizeHexColor(theme.colors.color6) ??
    normalizeHexColor(theme.colors.color2) ??
    mixColors(accent, foreground, 0.18);
  const themeName = theme.name.trim() || "unknown";
  const bg1 = mixColors(background, foreground, 0.06);
  const bg2 = mixColors(background, foreground, 0.1);
  const bg3 = mixColors(background, "#000000", 0.35);
  const panel = mixColors(background, foreground, 0.08);
  const panelSoft = mixColors(background, foreground, 0.12);

  const root = document.documentElement;
  root.setAttribute("data-omarchy-theme", theme.name);
  root.style.setProperty("--bg-0", background);
  root.style.setProperty("--bg-1", bg1);
  root.style.setProperty("--bg-2", bg2);
  root.style.setProperty("--bg-3", bg3);
  root.style.setProperty("--bg-radial-1", withAlpha(accent, 0.32));
  root.style.setProperty("--bg-radial-2", withAlpha(accentAlt, 0.28));
  root.style.setProperty("--scanline", withAlpha(accent, 0.05));
  root.style.setProperty("--panel", panel);
  root.style.setProperty("--panel-soft", panelSoft);
  root.style.setProperty("--line", line);
  root.style.setProperty("--line-strong", lineStrong);
  root.style.setProperty("--ink", foreground);
  root.style.setProperty("--muted", muted);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-strong", accentStrong);
  root.style.setProperty("--accent-soft", withAlpha(accent, 0.18));
  root.style.setProperty("--warning", warning);
  root.style.setProperty("--danger", danger);
  root.style.setProperty("--shell-grad-top", mixColors(background, foreground, 0.12));
  root.style.setProperty("--shell-grad-bottom", mixColors(background, foreground, 0.03));
  root.style.setProperty("--shell-grid", withAlpha(accent, 0.04));
  root.style.setProperty("--shell-highlight", withAlpha(foreground, 0.1));
  root.style.setProperty("--chip-bg", withAlpha(mixColors(background, foreground, 0.08), 0.8));
  root.style.setProperty("--kbd-border", mixColors(background, foreground, 0.36));
  root.style.setProperty("--kbd-bg", withAlpha(mixColors(background, foreground, 0.16), 0.94));
  root.style.setProperty("--surface-grad-top", mixColors(background, foreground, 0.1));
  root.style.setProperty("--surface-grad-bottom", mixColors(background, foreground, 0.04));
  root.style.setProperty("--surface-inset", withAlpha(foreground, 0.04));
  root.style.setProperty("--surface-shadow", withAlpha(mixColors(background, "#000000", 0.8), 0.28));
  root.style.setProperty("--skeleton-a", mixColors(background, foreground, 0.12));
  root.style.setProperty("--skeleton-b", mixColors(background, foreground, 0.2));
  root.style.setProperty("--input-border", mixColors(background, foreground, 0.27));
  root.style.setProperty("--input-bg", withAlpha(mixColors(background, foreground, 0.04), 0.88));
  root.style.setProperty("--placeholder", withAlpha(muted, 0.82));
  root.style.setProperty("--focus-ring", withAlpha(accentStrong, 0.24));
  root.style.setProperty("--hint-kbd-border", mixColors(background, foreground, 0.32));
  root.style.setProperty("--hint-kbd-bg", withAlpha(mixColors(background, foreground, 0.11), 0.95));
  root.style.setProperty("--button-border", mixColors(background, foreground, 0.3));
  root.style.setProperty("--button-grad-a", mixColors(background, foreground, 0.14));
  root.style.setProperty("--button-grad-b", mixColors(background, foreground, 0.09));
  root.style.setProperty("--button-primary-border", mixColors(accent, foreground, 0.18));
  root.style.setProperty("--button-primary-grad-a", mixColors(accent, background, 0.42));
  root.style.setProperty("--button-primary-grad-b", mixColors(accent, background, 0.3));
  root.style.setProperty("--button-primary-ink", mixColors(foreground, "#ffffff", 0.18));
  root.style.setProperty("--button-primary-glow", withAlpha(accent, 0.24));
  root.style.setProperty("--button-danger-border", mixColors(danger, foreground, 0.12));
  root.style.setProperty("--button-danger-grad-a", mixColors(danger, background, 0.4));
  root.style.setProperty("--button-danger-grad-b", mixColors(danger, background, 0.28));
  root.style.setProperty("--button-danger-ink", mixColors(foreground, "#ffffff", 0.14));
  root.style.setProperty("--badge-ok-border", mixColors(accentStrong, foreground, 0.2));
  root.style.setProperty("--badge-ok-ink", mixColors(accent, foreground, 0.3));
  root.style.setProperty("--badge-ok-bg", withAlpha(accent, 0.16));
  root.style.setProperty("--badge-warn-border", mixColors(warning, foreground, 0.2));
  root.style.setProperty("--badge-warn-ink", mixColors(warning, foreground, 0.35));
  root.style.setProperty("--badge-warn-bg", withAlpha(warning, 0.16));
  root.style.setProperty("--intent-border", mixColors(background, foreground, 0.31));
  root.style.setProperty("--toggle-border", mixColors(background, foreground, 0.3));
  root.style.setProperty("--toggle-bg", withAlpha(mixColors(background, foreground, 0.06), 0.68));
  root.style.setProperty("--tag-divider", mixColors(background, foreground, 0.28));
  root.style.setProperty("--tag-chip-border", withAlpha(accent, 0.42));
  root.style.setProperty("--tag-chip-ink", mixColors(accent, foreground, 0.38));
  root.style.setProperty("--dedupe-bg-a", withAlpha(warning, 0.22));
  root.style.setProperty("--dedupe-bg-b", withAlpha(mixColors(background, foreground, 0.05), 0.94));
  root.style.setProperty("--queue-empty-border", mixColors(background, foreground, 0.29));
  root.style.setProperty("--queue-empty-bg", withAlpha(mixColors(background, foreground, 0.06), 0.62));
  root.style.setProperty("--queue-item-border", mixColors(background, foreground, 0.24));
  root.style.setProperty("--queue-item-bg", withAlpha(mixColors(background, foreground, 0.05), 0.66));
  root.style.setProperty("--status-border", mixColors(background, foreground, 0.28));
  root.style.setProperty("--status-bg", withAlpha(mixColors(background, foreground, 0.06), 0.76));
  root.style.setProperty("--theme-name", `"${escapeCssString(themeName)}"`);
};

const makeThemeSignature = (theme: OmarchyTheme) =>
  `${theme.name}|${Object.entries(theme.colors)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("|")}`;

function App() {
  const { hydrate, loading, refreshQueue } = useBookmarkStore();

  useEffect(() => {
    let cancelled = false;
    let lastThemeSignature = "";

    const syncTheme = async () => {
      try {
        const theme = await getOmarchyTheme();
        if (cancelled) {
          return;
        }

        if (!theme) {
          document.documentElement.style.setProperty("--theme-name", '"omarchy-not-found"');
          return;
        }

        const nextSignature = makeThemeSignature(theme);
        if (nextSignature === lastThemeSignature) {
          return;
        }

        applyOmarchyTheme(theme);
        lastThemeSignature = nextSignature;
      } catch {
        if (!cancelled) {
          document.documentElement.style.setProperty("--theme-name", '"omarchy-error"');
        }
      }
    };

    void syncTheme();
    const intervalId = window.setInterval(() => {
      void syncTheme();
    }, THEME_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void (async () => {
          try {
            await getCurrentWindow().hide();
          } catch {
            try {
              await getCurrentWindow().minimize();
            } catch {
              // No-op if window controls are unavailable.
            }
          }
        })();
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
    return <main className="app-shell loading">Booting ommapin...</main>;
  }

  return <QuickAddForm />;
}

export default App;
