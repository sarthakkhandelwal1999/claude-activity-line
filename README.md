# activity-line

A Claude Code plugin that shows what your session is doing: context usage, rate limits, cost, running tools, running agents and todo progress. It does this in two places:

- **The line under the prompt** (terminal and Claude Code Desktop). A colour-coded row sits beneath the usual hint row and is always visible:

  ```
  ctx ███████░░░ 65% 130k/200k  │  ☑ 1/3 Testing it  │  ⚙ Bash 45s · Read×2  │  5h 84% ↻1h30m  7d 12%  │  ◆ Explore: Find the poller  │  $0.84
  ```

- **The `/activity` dashboard** (every surface, including the VS Code extension). This is a pane with a meter for the context window and each rate-limit window. It also lists every running tool with its elapsed time, every running agent with its status, and the whole todo list.

## Colours

| Part | Green | Yellow | Red |
| --- | --- | --- | --- |
| Context window | under 60% | 60 to 79% | 80% and over (auto-compact is near) |
| Rate-limit windows (5-hour, 7-day, spend) | under 50% | 50 to 79% | 80% and over |
| Elapsed time of a running tool | | 30 seconds and over | 2 minutes and over |

A few parts have their own colour: tools in blue, agents in purple, the todo in progress in teal, and cost in Claude orange. Colours come from the active Claude Code theme, so they work in light, dark and colour-blind themes.

The reset countdown appears on the line once a window is half used; the dashboard always shows it. When the terminal is too narrow for the whole line, the bars shrink first. Then parts are dropped in this order: cost, agents, rate limits, tools, todos. The context part always stays.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install activity-line --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick the **user** scope so the plugin runs in every project. It starts working in that session straight away.

To install from a local copy of this folder instead:

```
claude plugin marketplace add /path/to/claude-activity-line
claude plugin install activity-line@activity-line --scope user
```

A plugin installed from a local folder is read from that folder. After editing it, run `/reload-plugins`.

## Settings

The settings are in `/config`, under the plugin, or in `settings.json` under `pluginConfigs`:

| Setting | Values | Default |
| --- | --- | --- |
| `placement` | `below` (under the prompt), `above` (the band above the prompt), `pane-only` | `below` |
| `openPane` | `auto` (open the dashboard at start only where there is no line, such as VS Code), `always`, `never` | `auto` |

## Where the figures come from

Context, rate limits and cost are the same figures Claude Code's own status line uses. Rate limits only appear on a Claude subscription, after the first response of the session. Tools are counted from the moment a call starts until its result returns, including calls made inside subagents. Agents are the session's subagents and teammates that are pending, running or waiting, checked every 1.5 seconds. Todos come from the main conversation's latest todo-list update.

The plugin only reads. It never blocks a tool call; if it fails while watching one, the call goes ahead.

## Development

```
claude plugin validate .
claude plugin test .
```

`hooks/model.ts` builds the line and the colour tones and has no engine calls. `hooks/register.tsx` collects the figures and draws the line and the pane. `types/index.d.ts` declares the session state that both read.
