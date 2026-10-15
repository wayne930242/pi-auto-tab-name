# pi-auto-tab-name

A [pi](https://pi.dev/) extension that names the [Herdr](https://herdr.dev/) tab a pi session runs in, so a row of `1` · `2` · `3` becomes `mp-3464` · `修 PDF 縮圖` · `fix the parser`.

## How it names a tab

- The session name wins: one set with `/name`, by another extension, or restored on resume.
- A session without a name uses its first prompt, cut to 16 characters with a trailing `…`. No model call is made.
- Renaming the session later renames the tab; clearing the name falls back to the first prompt.

## What it leaves alone

- A tab whose label is anything other than a bare number (Herdr's default) or a label this extension set. Rename a tab yourself, or let another tool name it, and the extension stops touching it.
- Subagent sessions (`PI_SUBAGENT_ID` set), so a worker never renames the tab it shares with its parent.
- Sessions outside Herdr (`HERDR_PANE_ID` unset): the extension registers nothing.

A failing `herdr` command is ignored; a tab label is cosmetic and never interrupts the session.

## Install

```bash
pi install npm:pi-auto-tab-name
```

Then run `/reload` in open sessions.

## Requirements

- Herdr with `herdr pane get`, `herdr tab get`, and `herdr tab rename` (tested on 0.9.4).
- pi with the `before_agent_start` and `session_info_changed` events.

## Development

```bash
npm install
npm run check
npm test
```

## License

MIT
