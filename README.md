# pi-auto-tab-name

A [pi](https://pi.dev/) extension that names the [Herdr](https://herdr.dev/) tab a pi session runs in, so a row of `1` · `2` · `3` becomes `mp-3464` · `Nomad Redis 重啟排查` · `Fix The Parser`.

## How it names a tab

- The session name wins: one set with `/name`, by another extension, or restored on resume.
- A session without a name gets a title from a small model, written as the session name, so `/resume` and the tab agree. Until it arrives, and whenever it fails, the tab shows the first prompt cut to 16 characters with a trailing `…`.
- After a compaction, a title this extension generated is regenerated from the compaction summary, so the tab follows the work as it moves on. A name you chose is never replaced.
- Renaming the session later renames the tab; clearing the name falls back to the first prompt.

### Title model

With no configuration the extension picks the newest small model it can use: Claude Haiku, GPT Luna, or Gemini Flash, preferring the session's provider, then any signed-in provider, then the session's own model. One call per session, plus one per compaction.

Override it in `~/.pi/agent/auto-tab-name.json`:

```json
{ "model": "openai/gpt-6-luna" }
```

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | `true` | `false` turns model titles off; tabs use the session name or the first prompt only. |
| `model` | automatic | `provider/model-id` for titles, or `"session"` for the session's own model. An unavailable model falls back to the automatic pick. |

## What it leaves alone

- A tab whose label is anything other than a bare number (Herdr's default) or a label this extension set. Rename a tab yourself, or let another tool name it, and the extension stops touching it.
- Tabs it is not the coordinator of: only the tab's first pane (top-left in layout order) names it, so workers and other sessions split into the tab never change its label.
- Subagent sessions (`PI_SUBAGENT_ID` set) and sessions outside Herdr (`HERDR_PANE_ID` unset): the extension registers nothing.

A failing `herdr` command or model call is ignored; a tab label is cosmetic and never interrupts the session.

## Install

```bash
pi install npm:pi-auto-tab-name
```

Then run `/reload` in open sessions.

## Requirements

- Herdr with `herdr pane layout`, `herdr tab get`, and `herdr tab rename` (tested on 0.9.4).
- pi with the `before_agent_start`, `session_compact`, and `session_info_changed` events (tested on 1.2.0).

## Development

```bash
npm install
npm run check
npm test
```

## License

MIT
