# Focus Timer

A personal Pomodoro timer with a task list. Hebrew, right-to-left. One page that runs in two places:

- **Website**: `index.html` at the repo root, served by GitHub Pages at https://zivlevy-code.github.io/focus-timer/ (no build step).
- **Windows desktop app**: an Electron wrapper around the same `index.html`, built into an installer by GitHub Actions.

## How to work with me (the owner)

- I am not a programmer. **Reply in Hebrew**, in plain language. Say what changed and what I should look at, not how the code works. Code, commit messages and code comments stay in English.
- Work in small steps. Before anything hard to undo (pushing, deleting files, changing `package.json` versions), tell me and wait.
- After a change, **run the app** (`npm start`) and tell me exactly what to try, for example "press Ctrl+Alt+T and expect a tomato to splat in the middle of the screen".
- Say plainly what you could not test. Do not claim something works on Windows if you only ran it elsewhere.

## Layout

| File | What it is |
|---|---|
| `index.html` | The whole UI: HTML, CSS and JS in one file. Plain `var` and function declarations, no frameworks, no build. Everything the user sees is here. |
| `main.js` | Electron main process: window, tray icon, global shortcuts, taskbar progress, away detection (lock, sleep, idle), the transparent full-screen effect windows, IPC. |
| `preload.js` | Bridge to the page. Exposes `window.focusApp`. Mirrors localStorage to a data file and keeps `tasks.md` in sync. |
| `tasksmd.js` | Reads and writes the tasks markdown file. Pure functions, unit tested. |
| `confetti.html`, `confetti-preload.js` | Page drawn in the transparent overlay windows: confetti, tomato rain, the thrown tomato. |
| `scripts/prepare.js` | Run before start and build. Builds `app/index.html` (strips Google Fonts, injects bundled fonts and a CSP) and generates `build/icon.png`. |
| `.github/workflows/build-windows.yml` | Manual workflow ("Run workflow" in the Actions tab) that builds the installer and uploads it as an artifact (kept about 90 days). |
| `app/`, `build/`, `release/`, `node_modules/` | Generated. Never edit, never commit. |

## The rule that matters most

`index.html` is shared. **The website must keep working with no `window.focusApp`.** Everything that needs the desktop app is guarded:

```js
if (window.focusApp && window.focusApp.something) { ... }
```

App-only things: the tasks file, global shortcuts (and changing them), start with Windows, saving the Excel export through a save dialog (the website downloads it instead), away detection, full-screen effects, the file buttons in Settings. The opposite way round, "float above windows" and "keep screen on" exist only on the website. In the legend, app-only rows carry the class `app-only` and are hidden on the website.

## Languages

The page is Hebrew (right-to-left) by default, with an English option in Settings (`S.lang`, saved with the rest of the state). Every piece of text needs both languages:

- Text built in JS: `L('עברית', 'English')`.
- Fixed text in the HTML: add the English to the `EN` dictionary, keyed by the exact Hebrew text (or attribute value). Elements filled in by code are listed in `DYNAMIC` and are never run through `EN`, so task names and tags are never translated.
- The tray menu and tooltip in `main.js` follow `status.lang`.
- "Backlog" is written in English in both languages (the owner prefers it to "גב־לוג").

Do not add network requests. The app runs offline and its CSP blocks them. Do not put secrets anywhere: the repo is public and every file in the root is served on the website.

## Data

- Page state lives in `localStorage` under `focus-timer-v1` (one JSON object: tasks, history, settings, counters).
- In the app, `preload.js` copies that to `%APPDATA%\Focus Timer\focus-timer-data.json` and loads it back at startup, so the file is the source of truth.
- Tasks are also mirrored to `Documents\Focus Timer\tasks.md`. One checkbox per task:
  `- [ ] Title #tag !high @2026-11-10 <!--t:ID-->`. A heading containing "Backlog" starts the backlog. Everything that is not a checkbox line must be left untouched when the file is rewritten. Hand-typed lines without an id get a stable id derived from their text.
- Time spent, history and counters are **not** in the markdown file. They are matched to tasks by id. Deleting a line deletes that task (finished ones go to history).
- A task: `{ id, text, done, ms, pri (0,1,2), due, tags[], section ('today'|'backlog'), doneAt, note, est, pomos, repeat ('daily'|'weekdays'|'weekly'), repeatDay }`. `note`, `est` (estimated rounds), `pomos` (rounds done) and `repeat` live only in the data file, matched by id.
- `log` in the state: per working day (`YYYY-MM-DD`, the day turns at 4 AM, see `workDay()`) `{ ms, rounds, tags: { lowercased tag or '': ms } }`, kept 400 days. Feeds the week table, the daily goal and the weekly report.
- Other state: `zoom` (display size), `mail` (the user's own address for the weekly report, stored only locally), `reportWeek` (the Sunday of the last week whose report was offered), `lastDay`, `xp` (tomatoes ever, for levels), `distractOn`, `distractList`, `round` (the round in progress: distraction time, squashed), `pausedAt`, `brkWatch`.
- Per day the log also holds `garden: [{ k: 'ok'|'squash'|'gold', at, s (focus %), why, name }]` and `distract: { name: ms }`.
- The order of tasks in the app is the order in `tasks.md` (drag to reorder rewrites the file order; headings and notes stay put).

## Behaviour to preserve

- Timer: tick every 250 ms, time credited by clock difference. Work rounds, short break, long break every 4th round (settings), lunch break (user picks minutes), "finished early" choice.
- Away detection (app only): lock, sleep or 3 min idle pauses the round **as of when the user left** and gives that time back to the task. Manual pause is never auto-resumed. Away more than 30 min cancels the round.
- Tomato rain over the whole screen runs for the whole of a normal or long break. Lunch gets only about 10 seconds.
- Today's list drives the timer. The backlog is only used when today is empty.
- Repeating tasks: when done and the day ends (or done tasks are cleared), a copy goes to history and the task comes back unticked with its next date as the due date, waiting in the backlog until that day. Week days are Sunday to Thursday.
- The day turns by itself at 4 AM (not midnight, so late nights count as the same day). On the first check after that, the page shows a summary of the day that ended, archives finished tasks and resets the round counter. A round still running at 4 AM delays this until it ends. There is no "new day" button any more.
- Ticking a task (or "task done") with less than 5 minutes on it asks how long it took, in tomatoes (½ to 4, one tomato = the work minutes setting) or minutes. The task is topped up to that time, and every full tomato counts as a round toward the daily goal.
- Weekly report (Sunday to Saturday): shown by itself on the first day of a new week if last week had work, and from the History section any time. "Send to me in Gmail" opens a Gmail draft in the browser (`shell:openMail` in the app, which only accepts `https://mail.google.com/mail/` links). Nothing is sent by the app itself.
- The game layer ("the tomato garden"): every finished round grows a tomato under the timer; the round in progress shows a tomato growing from green to red. A round is squashed by a reset after its first minute, a manual pause of more than 5 minutes, or (app only) 3 minutes on a distracting site. Squashed rounds plant a splat and do not count toward the goal. A break with less than 40 seconds at the keyboard gives a golden tomato (app only); after 40 seconds a reminder says to step away. Away detection, lunch and "away 30 minutes" never squash. Badges above the timer: streak of days on goal (Friday and Saturday without work do not break it), level from `xp`, today's average focus.
- Distraction detection (app only, Settings): `main.js` runs a small PowerShell loop during focus rounds (and a minute after) that reports the program and title of the window in front every 3 seconds, only when it changes. The page matches it against `distractList`. After 20 seconds a warning, after 3 minutes in the round the tomato is squashed and a tomato is thrown at the screen. Time on a distracting site is not credited to the task. Only per-site totals are stored, never window titles. Warnings, the squash and the break reminder also appear as a big message in the middle of every screen (`effects:message`, drawn in `confetti.html`). Measured cost: about 0.4% of one core and 85 MB while it runs.
- Sounds: the end-of-round chime is a ringing bell by default, with a "sharp" option that is heard over music. In the app, confetti plays synthesized applause, a crowd roar and finger whistles (noise only; buzzing tones sounded like a race car), and the thrown tomato a slide whistle and a splat, from the overlay windows at the page's volume (one confetti sound, from the main screen only).
- Display size: Settings, or Ctrl + / Ctrl - / Ctrl 0. The app uses `webFrame.setZoomFactor`, the website CSS `zoom`.
- Delete shows a toast with undo for 7 seconds.
- Tags: `#word` in a task name (letters only, so `#42` and `C#` are not tags). Case-insensitive, kept as first written.

## Shortcuts (global, app only)

Defaults in `DEFAULT_KEYS` in `main.js`: `Ctrl+Alt+S` start, pause, resume, or end a break. `Ctrl+Alt+P` show or minimize the window. `Ctrl+Alt+N` quick note (brings the window forward, saves a line to the backlog, then puts the window back). `Ctrl+Alt+C` confetti on the whole screen. `Ctrl+Alt+T` throw one tomato at the middle of the screen. The user can change each one from the shortcut legend ("שנה"); the choice is saved in `%APPDATA%\Focus Timer\shortcuts.json`. The legend is built from `KEY_INFO` in `index.html` and warns if another program owns a key. Keep `KEY_INFO` and `DEFAULT_KEYS` in sync.

## Run, test, build

```
npm install
npm start          # prepares app/ and opens the desktop app
node tests/tasksmd.test.js   # unit tests for the tasks file module
npm run dist       # Windows installer into release/ (needs Windows, or use the GitHub workflow)
```

- To try the website version, open `index.html` directly in a browser.
- For the installer: push, then GitHub → Actions → "Build Windows app" → Run workflow → download the artifact from the finished run. The installer is unsigned, so Windows SmartScreen shows a warning ("More info" → "Run anyway").
- Pinned on purpose: `electron` 44.9.3, `electron-builder` 26.18.0, `@fontsource/*` 5.3.0. Do not bump without asking.

## Not yet verified on a real Windows machine

Distraction detection with real browsers (the window watcher), the golden tomato and break reminder with real idle times, the tray icon and its menu (now in Hebrew), taskbar progress bar, system notifications, lock and sleep detection, the full-screen effect windows on real displays and several monitors, the squash sound, opening `tasks.md` in the default editor, upgrading over an existing install, start with Windows, the quick-note shortcut returning the window to where it was, and recording new shortcut keys. Check these first when working on a Windows machine, and tell me what you see.

## Known limits and ideas

- Effects do not show over exclusive full-screen games or video.
- Ideas not built: subtasks with their own checkboxes (notes are free text for now), a time-of-day view of history, sync between devices (needs an online store such as Firebase or Supabase), choosing where `tasks.md` lives.
