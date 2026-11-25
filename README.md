# Netstral

Browser extension companion for a Mistral account (Chrome / Firefox): the
toolbar badge shows your real account usage at a glance, and the pop-up
offers one-click shortcuts to chat.mistral.ai, console.mistral.ai and
admin.mistral.ai.

Published on [Firefox — addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/netstral/) and [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/netstral/iahobbehkdeofjiopmcamnlanponpjce) (Chrome Web Store listing not created yet).

Companion project of [Monstral](https://github.com/scabon/monstral) (WearOS app). No backend, no intermediate cloud: usage is read directly from console.mistral.ai / admin.mistral.ai using your browser's Mistral session cookie.

## Features

- Toolbar badge with the real usage of your Mistral account (% of the current budget), color-coded green, orange, red — refreshed every 30 minutes and on demand
- Pop-up showing the same percentage as a progress bar, account details (plan type, PAYG credits, reset date), quick links and settings
- Threshold alert: a notification when usage crosses a configurable percentage
- Light/dark theme, English and French
- Desktop browsers and Firefox for Android

## Privacy

- The extension reads your Mistral billing data only from `console.mistral.ai` and `admin.mistral.ai`, with the session cookie of the browser signed in to Mistral. No API key is stored; no call is made to `api.mistral.ai`.
- Without a Mistral session, nothing is read and the badge stays empty.
- No analytics, no tracking, no third-party server. Settings are stored locally (`storage.local`) and never synced.
- Host permissions are limited to `*.mistral.ai`. On Firefox (MV3) they are opt-in: open the extension options and click the network-permission button.

## Installation

- **Firefox** — [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/netstral/)
- **Chrome / Edge** — [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/netstral/iahobbehkdeofjiopmcamnlanponpjce)
- **From source** — load `extension/` as a temporary add-on (`about:debugging` on Firefox, `chrome://extensions` → Load unpacked on Chromium), or package with `npx web-ext build --source-dir extension`

## Project layout

- `extension/` — all extension code (Manifest V3, cross-browser Chrome/Firefox)
- `tests/` — Node smoke tests and the Marionette e2e suite (`tests/e2e/`)

Store-listing assets and the release/upload tooling are maintained privately by the author.

Add-on ID: `netstral@cabon14.com`.

## Development

- Lint: `npx web-ext lint --source-dir extension`
- Smoke tests: `node tests/load-smoke.mjs` (and the other `tests/*-smoke.mjs`)

## License

MIT — see [LICENSE](LICENSE).
