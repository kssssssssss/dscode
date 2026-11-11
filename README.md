<p align="center">
  <img src="assets/prod/black-macos-1024.png" alt="DS Code" width="160" />
</p>

<h1 align="center">DS Code</h1>

DS Code is my personal fork of [T3 Code](https://github.com/pingdotgg/t3code), the open source control surface for coding agents. It's my experimentation pad for new interactions and tools: ideas get tried here first, and some of them may never be more than experiments.

Like upstream, it works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, and fx. If they're set up on your computer, DS Code can control them.

For installation, supported providers, and everything else T3 Code does, see the [T3 Code README](https://github.com/pingdotgg/t3code#readme).

## What's different

### UI redesign

A quieter, blue-tinted interface with an app rail, project-grouped thread cards, unified panel surfaces, and the Aspekta and Azeret Mono typefaces.

<img width="4096" height="2489" alt="image" src="https://github.com/user-attachments/assets/3f652684-ce91-408f-afaf-c9ed6e84c71c" />

### Git Graph

A per-project graph of branches, worktrees, and the threads working on them, on web and mobile.

<img width="1081" height="635" alt="Screenshot 2026-10-25 at 12 09 44" src="https://github.com/user-attachments/assets/a28e0ad0-70c1-4dee-97ba-2b34be45c025" />

### Dashboard

All projects at a glance, grouped into active, working, snoozed, and settled. A card opens that project's graph; the board icon opens its task board.

<img width="601" height="360" alt="Screenshot 2026-10-25 at 11 02 55" src="https://github.com/user-attachments/assets/4b07102c-ae40-4004-9d95-c5cf9379b9b0" />

### Task boards

Two kanban views of agent threads. **Tasks** (`Ctrl+Alt+T`, or `Cmd+Alt+T` on macOS) is one board for every thread, with columns for to do, in progress, needs review, blocked, and done. **Project board** is the same board for a single project, beside that project's recent commits. Filter by project, provider, and status. Drag a resting card between To do, Needs review, and Done; the move settles, unsettles, or wakes the thread when that is what the column means. A running thread, or one waiting on you, stays in the column its status already has. Open a card to jump to the thread.

A card also shows that thread's latest todo list (`3/7` and the step that is running). In the Threads view the card adds a stacked bar of those steps — done, running, pending, and blocked — with the counts and the percent complete. A step that is not done counts as blocked when the thread is waiting on approval, input, a guest, or a proposed plan, or when the run failed, was interrupted, or stopped with steps left unfinished. The blocked count says which. A panel at the top totals the threads in view and lists each one, sortable by percent complete. Expand a list for the explanation and every step, with duration when the agent reported one. A proposed plan starts as a few lines and expands to the full markdown; **Open plan** puts a long plan in a scrollable dialog. **Previous plans** lists older versions, newest first, including ones the live snapshot only kept as a status. **Steps** turns each todo item into its own card under Pending, Running, and Completed, and can open that same plan. The project, provider, and status filters still choose which threads those steps come from.

**Planned tasks** is a third view of the markdown issues in the project, not of threads. By default the server reads `tasks/<topic>/issues/NN-title.md`. A project can point somewhere else with `.t3/task-board.json`:

```json
{ "issuesGlob": "tasks/*/issues/*.md" }
```

`Status` on an issue is only a triage badge. `Execution` (`open`, `claimed`, `blocked`, `resolved`) is the column. An issue with no Execution stays **unknown / not tracked**, never done. Acceptance is the checkboxes under `## 交付与验收` (or `## 验收条件` / `## 范围与验收`). A task is **ready** when it is open and every `Blocked by` task in the same topic is resolved. Threads, including child threads, link from a task number in the title, branch, worktree, or opening message, and a link or unlink on the card is remembered in this browser. The progress bars count each planned task once. A finished thread does not accept a task. Parent rows can show a rollup labeled "including children"; that rollup is not added again to the total. On the project board the scan uses the selected checkout. On the overall board each project uses its first checkout. If that checkout's server does not serve planned tasks, and this app's own server is on the same machine, the files are read there instead. The board names the server that read them. Threads still come from the project's server.

## Trying it

The web app is hosted at **[dominikscholz.github.io/dscode](https://dominikscholz.github.io/dscode/)**. Like [app.t3.codes](https://app.t3.codes), it's only the interface: it connects to a T3 server running on your own machine. Pair one under **Settings → Connections → Add environment**.

A stock T3 server works, but some features here need DS Code's own server. To run everything from source, install [Vite+](https://viteplus.dev/guide/):

```bash
# macOS / Linux
curl -fsSL https://vite.plus | bash

# Windows (PowerShell)
irm https://vite.plus/ps1 | iex
```

Then:

```bash
vp i
vp run dev
```

## License

The code is available under the [MIT License](LICENSE), as is upstream T3 Code by T3 Tools Inc.

The DS logo and DS Code app icons are © Dominik Scholz. All rights reserved. They are not covered by the MIT License and may not be used without permission.
