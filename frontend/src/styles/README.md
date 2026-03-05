# Frontend Style Structure

This folder contains the organized replacement for the old monolithic `frontend/src/index.css`.

## Files

- `core.css`: global fonts import, design tokens, reset, base `body` styles.
- `auth.css`: authentication gate/loading UI.
- `app-shell-and-home.css`: nav, shared app shell, Home/desk flow, and shared page-level primitives.
- `proceeding-setup.css`: proceeding setup wizard styles (legacy section preserved).
- `ritual-overlay.css`: courtroom ritual overlay.
- `courtroom-overlays.css`: active courtroom overlay components (judge bubble, timer, interrupt log, sentiment panel).
- `courtroom-fullscreen.css`: active courtroom fullscreen HUD layout primitives.
- `utility-legacy.css`: utility class block used by legacy multi-agent UI patterns.
- `courtroom-theme-alignment.css`: home-theme visual alignment overrides for courtroom/final flow.

## Entry points

- `frontend/src/styles/index.css` is the canonical ordered import list.
- `frontend/src/index.css` is a compatibility shim that imports `styles/index.css`.

## Notes

- Style order in `styles/index.css` is intentional to preserve cascade behavior.
- Prefer adding new selectors to the most specific domain file rather than creating cross-domain overrides.
