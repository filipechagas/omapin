# manual test matrix

## quick add
- Open app and submit a valid URL with title, notes, tags.
- Verify bookmark appears in Pinboard account.

## clipboard prefill
- Copy valid URL and open app, verify URL field prefilled.
- Copy non-URL text and open app, verify no forced invalid value.

## suggestions
- Enter URL and blur field, verify suggested tags appear.
- Click `Add all`, verify tags merge without duplicates.

## duplicate handling
- Enter existing Pinboard URL, verify duplicate banner appears.
- Use `Use existing data`, verify fields sync from existing bookmark.
- Toggle `Update existing` and `Create new` intent and submit.

## queue and retries
- Disable network, submit bookmark, verify queued status.
- Re-enable network, click `Retry now`, verify queue drains.

## window behavior
- Press `Esc`, verify app window hides.
- Re-open via your configured launcher/keybind and verify focus is restored.
