# Omarchy setup

## launcher script
1. Install/build `ommapin` and place binary at `~/.local/bin/ommapin`.
2. Copy helper script:

```bash
install -Dm755 scripts/ommapin-toggle.sh ~/.local/bin/ommapin-toggle.sh
```

3. Optional: if binary is elsewhere, set `OMMAPIN_BIN` in your shell/session.

## Optional Hyprland keybind (Omarchy override)
ommapin does not create any global keybind automatically. Add one only if you want it:

```ini
bind = SUPER, <your-key>, exec, ~/.local/bin/ommapin-toggle.sh
```

Reload Hyprland and test: your chosen key should open/focus ommapin.

## behavior notes
- `Esc` hides the window.
- Relaunching app while already running should focus the existing window (single-instance plugin).
