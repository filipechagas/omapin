# ommapin

Keyboard-first Pinboard bookmark capture app built with Rust + Tauri for an Arch/Omarchy workflow.

## features (Power MVP)
- Quick add form: URL, title, notes, tags, private, read later.
- URL duplicate check with edit/create intent.
- Tag suggestions from Pinboard (`posts/suggest`) with `Add all`.
- Offline queue with retry and queue status.
- Single-instance behavior for keybind-driven reopen/focus.

## setup
```bash
npm install
npm run tauri dev
```

## arch linux prerequisites
Install Tauri runtime dependencies before building/running Rust side:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libayatana-appindicator base-devel
```

If Rust build fails with missing `javascriptcoregtk-4.1` or `webkit2gtk-4.1`, these packages are the fix.

## docs
- `docs/architecture.md`
- `docs/manual-test-matrix.md`
- `docs/omarchy-setup.md`
