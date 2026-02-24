# ommapin

Keyboard-first Pinboard bookmark capture app built with Rust + Tauri for an Arch/Omarchy workflow.

## features (Power MVP)
- Quick add form: URL, title, notes, tags, private, read later.
- URL duplicate check with edit/create intent.
- Tag suggestions from Pinboard (`posts/suggest`) with `Add all`.
- Offline queue with retry and queue status.
- Single-instance behavior for launcher/keybind-driven reopen/focus.
- Automatically follows the active Omarchy theme colors (when `~/.config/omarchy/current/theme/colors.toml` is present).

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

ommapin stores auth in the desktop keyring via Secret Service. Ensure a Secret Service provider is running and unlocked in your session (for example `gnome-keyring` or `kwallet`).

## releases (semver + changelog)
Releases are automated from commits merged into `master` using Release Please + Conventional Commits.

- `feat:` bumps minor.
- `fix:` bumps patch.
- `feat!:` / `fix!:` (or `BREAKING CHANGE:` in the body) bumps major.

Each release publishes a generated changelog and a Linux `x86_64` build artifact.

If release PR creation is blocked by repository policy, either enable **Settings -> Actions -> General -> Workflow permissions -> Allow GitHub Actions to create and approve pull requests** or set a `RELEASE_PLEASE_TOKEN` secret (PAT with `repo` scope).

## install latest linux x86_64 release on omarchy
```bash
curl -fLO https://github.com/filipechagas/omapin/releases/latest/download/ommapin-linux-x86_64.tar.gz
curl -fLO https://github.com/filipechagas/omapin/releases/latest/download/ommapin-linux-x86_64.tar.gz.sha256
sha256sum -c ommapin-linux-x86_64.tar.gz.sha256
tar -xzf ommapin-linux-x86_64.tar.gz
install -Dm755 ommapin ~/.local/bin/ommapin
install -Dm755 ommapin-toggle.sh ~/.local/bin/ommapin-toggle.sh
```

If you want the binary somewhere else, set `OMMAPIN_BIN` in your shell/session.

## optional app launcher entry in omarchy (walker)
Omarchy's app launcher (`walker`) reads `.desktop` files from `~/.local/share/applications`.
Create an entry for ommapin:

```bash
install -d ~/.local/share/applications
cat > ~/.local/share/applications/ommapin.desktop <<'EOF'
[Desktop Entry]
Type=Application
Version=1.0
Name=ommapin
Comment=Keyboard-first Pinboard quick add
Exec=/home/<your-user>/.local/bin/ommapin-toggle.sh
TryExec=/home/<your-user>/.local/bin/ommapin
Terminal=false
Categories=Network;Utility;
Keywords=bookmark;pinboard;omarchy;
StartupNotify=false
EOF
```

Replace `<your-user>` with your Linux username, then restart launcher indexing:

```bash
omarchy-restart-walker
```

## optional keyboard shortcut in omarchy (hyprland)
ommapin does not register a global shortcut by itself. If you want one, add your own bind in your local Hypr config override:

```ini
bind = SUPER, <your-key>, exec, ~/.local/bin/ommapin-toggle.sh
```

Reload Hyprland and test with the key you chose.

## docs
- `docs/architecture.md`
- `docs/manual-test-matrix.md`
- `docs/omarchy-setup.md`
