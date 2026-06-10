---
name: obsidian-zentao-center
description: Read and write tasks in an Obsidian vault through the Zentao Center plugin's CLI. Use when the user wants to list, schedule, complete, abandon, nest, or add tasks — or when they want estimate-accuracy / review / agent-brief stats. Obsidian must be running with the `zentao-center` plugin enabled; all verbs are namespaced `obsidian zentao-center:<verb>`.
---

# Obsidian Zentao Center — CLI skill

This skill is the AI interface to the obsidian-zentao-center plugin. The plugin registers its verbs to Obsidian's native CLI (1.12.2+), so calls go `obsidian zentao-center:<verb> key=value …`.

For a full command index, run:

```bash
obsidian zentao-center
```

Data stays inline markdown. Syntax:

```
- [ ] Title #2象限 📅 2026-05-15 ⏳ 2026-04-24 ➕ 2026-04-23 [estimate:: 90m] [actual:: 75m]
```

| Field | Encoding | Meaning |
|---|---|---|
| `⏳ YYYY-MM-DD` | scheduled | which day the user plans to do it |
| `📅 YYYY-MM-DD` | deadline | external hard deadline |
| `➕ YYYY-MM-DD` | created | when the task was added |
| `✅ YYYY-MM-DD` | completed | done stamp (written when `[x]`) |
| `❌ YYYY-MM-DD` | cancelled | dropped stamp (written when `[-]`) |
| `[estimate:: Nm]` | estimate | minutes planned |
| `[actual:: Nm]` | actual | minutes actually spent |
| `#1象限..#4象限` | quadrant | Covey quadrants (1=urgent+important, 2=not-urgent+important, 3=urgent, 4=neither) |

## When to use this skill

- "list today's tasks" / "what do I have scheduled" → `zentao-center:list`
- "show task details" / "pull the raw line" → `zentao-center:show`
- "schedule X" / "move X to tomorrow" → `zentao-center:schedule`
- "mark X done" / "I finished X" → `zentao-center:done`
- "drop X" / "abandon X" / "remove X" → `zentao-center:abandon`
- "nest X under Y" / "make X a subtask of Y" → `zentao-center:nest`
- "log time on X" / "I spent 45m on X" → `zentao-center:actual`
- "add a task" / "remind me to …" → `zentao-center:add`
- "how accurate were my estimates" / "weekly review" → `zentao-center:stats`
- "what should I do next" / "brief me on today" → `zentao-center:brief`
- "end-of-day review" / "what happened this week" → `zentao-center:review`
- "list/manage/edit query tabs" / "show saved query DSL" / "run a preset view" → `zentao-center:query-list` / `zentao-center:query-show` / `zentao-center:query-run`
- "create/update/rename/copy/hide/delete/default a query tab" → `zentao-center:query-create` / `zentao-center:query-update` / `zentao-center:query-rename` / `zentao-center:query-copy` / `zentao-center:query-hide` / `zentao-center:query-delete` / `zentao-center:query-set-default`

**Do not** use `Read`/`Write` directly on task files to mutate tasks — use the CLI so `vault.process` locking + parser conventions are respected. Reading files is fine when you want broader context (the task body, surrounding notes).

## Before calling any verb

Verify the plugin is loaded:

```bash
obsidian plugins:enabled | grep task-center
```

If missing, ask the user to enable it. If Obsidian isn't running, the CLI will auto-launch (first call incurs latency).

If `obsidian task-center` works but a specific verb is missing, the vault is running an older plugin build. Ask the user to update/reload Zentao Center before using that verb.

## Verbs

### `zentao-center:list [filters]`

Read-only. Returns tasks matching all filters. Every row starts with `<path>:L<line>` as the id — safe to pipe.

```
obsidian zentao-center:list scheduled=today
obsidian zentao-center:list scheduled=unscheduled tag='#2象限'
obsidian zentao-center:list done=2026-04-01..2026-04-30
obsidian zentao-center:list overdue
obsidian zentao-center:list status=todo search=示例
```

`scheduled=` / `done=` vocabulary:
- `today` / `tomorrow` / `yesterday`
- `week` (this week) / `next-week`
- `month` / `next-month`
- `unscheduled` (only meaningful with `scheduled=`)
- ISO `YYYY-MM-DD`
- range `YYYY-MM-DD..YYYY-MM-DD`

Other flags: `overdue`, `has-deadline`, `status=todo|done|dropped`, `tag=<comma-sep>` (supports `#*象限`), `parent=<id>`, `search=<text>`, `limit=N`, `format=text|json` (JSON gives a structured array with every field — prefer it when you plan to parse).

### `zentao-center:show ref=<id>`

Full single-task detail — scheduled/deadline/estimate/actual/created/completed/cancelled/parent/children/raw.

### `zentao-center:stats [days=N] [group=<prefix>]`

Rolling-window estimate accuracy + tag minutes breakdown. Default `days=7`. `group=象限` aggregates matching tags into a section (useful for Covey quadrants). Output includes:

- `sum actual / sum estimate` ratio (calibration signal)
- `per-task mean / σ` for ratio variance
- `within band 11/18 (61%)` share inside `[0.8, 1.25]`
- per-tag minutes with ASCII bar chart

Use this to **correct planning-fallacy** when suggesting estimates. If the 7-day `ratio` is 1.3, new estimates should be scaled up by that factor vs. the user's gut feel.

### `zentao-center:brief [today=YYYY-MM-DD] [limit=N] [format=text|json]`

Agent brief for near-term planning. Shows overdue / today / unscheduled candidate counts, sample tasks, and executable next-action commands such as `done`, `abandon`, `schedule_today`, `schedule_tomorrow`, and `actual +15m`.

Use this when the user asks what to do next or wants a compact status overview before planning.

### `zentao-center:review [today=YYYY-MM-DD] [days=N] [limit=N] [format=text|json]`

End-of-day / weekly retrospective summary. Reports today and rolling-week windows: done, abandoned, delayed-open tasks, estimate-vs-actual totals, grouping summaries, and sample task ids.

Use this for shutdown reviews, weekly reviews, and "what actually happened?" questions. Prefer text output for user-facing summaries; use `format=json` only when you need to parse it.

### Query Tab / Preset verbs

Query Tabs are saved QueryPreset DSL objects. The CLI uses the same storage, schema, and validation as the GUI Query editor. Always target tabs by stable `id`, not display name.

Read:

```
obsidian zentao-center:query-list
obsidian zentao-center:query-list hidden=true format=json
obsidian zentao-center:query-show id=preset-week
obsidian zentao-center:query-run id=preset-today
obsidian zentao-center:query-run id=preset-today view=week anchor=2026-05-04
obsidian zentao-center:query-run id=preset-week view=month anchor=2026-05-01 format=json
```

`query-list` text output includes `id`, `name`, `builtin|custom`, `default`, and `hidden|visible`. JSON output returns:

```json
[
  { "id": "preset-week", "name": "Week", "builtin": true, "hidden": false, "default": false }
]
```

`query-run` executes the preset DSL against current vault tasks and renders the result by view:

- default: uses the preset's saved `view`.
- `view=list|week|month|matrix`: temporary display override; it does not save back to the preset.
- `anchor=YYYY-MM-DD`: week/month cursor date. Week output shows all 7 days with counts; month text output shows dated cells that contain tasks, while JSON contains all month cells.
- all task rows keep stable ids like `Tasks/Inbox.md:L42` so you can pipe into `show`, `schedule`, `done`, or `abandon`.

Create or update DSL:

```
obsidian zentao-center:query-create dsl='{"name":"工作","filters":{"tags":["#work"],"status":["todo"]},"view":{"type":"list"},"summary":[{"type":"count"}]}'
obsidian zentao-center:query-update id=sv-alpha dsl='{"name":"工作周","filters":{"tags":["#work"],"time":{"scheduled":"week"},"status":["todo"]},"view":{"type":"week"},"summary":[{"type":"count"}]}'
```

`query-save` is kept as an alias for `query-create`. Create always allocates a new id, even if the DSL contains one. Update preserves the target id and builtin/custom identity.

Manage tabs:

```
obsidian zentao-center:query-rename id=sv-alpha name="深度工作"
obsidian zentao-center:query-copy id=preset-week name="我的本周"
obsidian zentao-center:query-hide id=preset-week hidden=true
obsidian zentao-center:query-hide id=preset-week hidden=false
obsidian zentao-center:query-delete id=sv-alpha
obsidian zentao-center:query-set-default id=preset-week
obsidian zentao-center:query-set-default id=null
```

Rules:

- Builtin tabs can be hidden/unhidden, copied, renamed, updated, and set as default, but cannot be permanently deleted.
- Deleting a custom Query Tab deletes only that saved view, never tasks.
- Hidden tabs cannot be set as default.
- Invalid DSL fails with `error invalid_query` and leaves settings unchanged.

### Write verbs (idempotent, safe to retry)

All write verbs return `ok <id>` with a `before / after` diff, or `unchanged` if already in the target state.

```
obsidian zentao-center:schedule ref=Tasks/Inbox.md:L42 date=2026-04-25
obsidian zentao-center:schedule ref=Tasks/Inbox.md:L42 date=null       # clear ⏳

obsidian zentao-center:deadline ref=… date=2026-05-15
obsidian zentao-center:deadline ref=… date=null

obsidian zentao-center:estimate ref=… minutes=90m         # set [estimate::]
obsidian zentao-center:estimate ref=… minutes=null        # clear
obsidian zentao-center:actual   ref=… minutes=45m         # set [actual::]
obsidian zentao-center:actual   ref=… minutes=+15m        # additive

obsidian zentao-center:done   ref=… [at=YYYY-MM-DD]       # [x] + ✅
obsidian zentao-center:undone ref=…                        # reverse a done
obsidian zentao-center:abandon ref=…                       # [-] + ❌, cascades to todo children
obsidian zentao-center:drop   ref=…                        # deprecated alias for abandon

obsidian zentao-center:tag    ref=… tag='#基建'            # add
obsidian zentao-center:tag    ref=… tag='#基建' remove     # remove

obsidian zentao-center:nest   ref=… under=…                # make ref a subtask of under

obsidian zentao-center:add text="处理示例任务" tag='#3象限' scheduled=2026-04-26 [to=<path>] [deadline=…] [estimate=30m] [parent=<id>]
```

`zentao-center:add` target priority: explicit `to=` → parent's file (if `parent=` given) → today's Daily Note. There is no inbox fallback: when neither `to=` nor `parent=` is supplied, the Daily Notes core plugin must be enabled and configured or the command fails with `daily_notes_unavailable`. Default stamps `➕ today` unless `stamp-created=false`.

`abandon` / `drop` cascades to todo descendants only. Already completed / abandoned / cancelled descendants keep their historical stamps. To abandon just one line, pass a leaf task.

### Error shape

Errors go to stderr as:

```
error  <code>
    <human message>
```

Common codes: `task_not_found`, `ambiguous_slug`, `invalid_date`, `daily_notes_unavailable`, `invalid_nest`, `nest_partial`.

Recover by:
- `task_not_found` → re-run `zentao-center:list` to get fresh ids
- `ambiguous_slug` → the error message lists candidate ids; pick one
- `invalid_date` → convert to `YYYY-MM-DD`
- `daily_notes_unavailable` → enable/configure Daily Notes, or pass `to=<path>`
- `invalid_nest` / `nest_partial` → inspect the named source/target tasks before retrying

## Recommended workflows

### End-of-day wrap-up

1. `obsidian zentao-center:list done=today` → collect what got done.
2. `toggl entry list --since today` → cross-reference actual time per task.
3. For each completed task: `obsidian zentao-center:actual ref=… minutes=Nm` to record real time.
4. `obsidian zentao-center:review days=7` → read today's / week's completion, abandonment, delay, and estimate summary.
5. `obsidian zentao-center:stats days=7 group=象限` → read calibration.
6. `obsidian zentao-center:brief` or `obsidian zentao-center:list scheduled=unscheduled` + `obsidian zentao-center:list scheduled=tomorrow` → candidate pool.
7. Pick tomorrow's set (≤1 big, ≤2 small based on user's self-declared capacity), deadline-first, quadrant-2-first.
8. `obsidian zentao-center:schedule ref=… date=<tomorrow>` per chosen task; use `add` for anything new.

### Quick capture

User says "don't forget to X". Default to today's daily note:

```
obsidian zentao-center:add text="X"
```

Only set `scheduled=` / `deadline=` / `tag=` if the user specified them.

### Backfill completions

User says "I finished Y yesterday": `obsidian zentao-center:done ref=<id> at=<yesterday>`.

## Output contract

- Every list row starts with `<path>:L<line>` — pipe-friendly.
- Monetary / time values: minutes, no conversion. Format with `formatMinutes` convention (`90m`, `1h30m`).
- Writes print `before / after` — use this to confirm the mutation was what you intended.
- Stats output is ASCII-bar-charted; do not JSON-ify it before showing the user.
- `brief` and `review` default to greppable text; use `format=json` only for downstream parsing.

## Do not

- Do not edit task files directly with `Read` + `Write`; use the CLI so parser + locking invariants hold.
- Do not try to install a wrapper shell script called `obsidian-zentao-center`; the plugin uses Obsidian's native CLI.
- Do not call `obsidian task` / `obsidian tasks` (those are built-in, read-only) when you mean `zentao-center:…`.
- Do not stamp `✅` / `❌` / `➕` manually with `Edit` — let the plugin do it via `done` / `abandon` / `add`.
