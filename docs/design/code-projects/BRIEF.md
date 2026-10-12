# Code projects: design brief

Status: approved 2026-10-11 with these decisions, and built. The plan is `docs/plans/agent-code-projects.md`.

## Decisions

1. **Everything is a project.** Projects replace shared folders. There is no separate read-only folder concept and no Shared folders tab. A folder someone shared read-only before projects is listed under Projects as **Read only** until they choose **Allow changes**. It never gains write access on its own.
2. **Undo also lives in the conversation.** An answer whose run changed a project shows an Undo action among its message actions, after a confirmation, as well as on the Projects tab.
3. **Pick a project per chat, like Claude.** The composer has a **Project** menu beside the mode. A chat uses one project or none, and none is the default. Only the chosen project is attached to the chat's requests.

## Surfaces

- **Composer, Project menu.** Desktop only. The trigger reads "Project · name" or "Project · No project". The menu lists "No project", then each project with "Edit files and run commands", "Read only" or "Not found on this computer", then **Add a project…**, which opens the system folder picker and selects the new project. Choices are checkmarked radio items. A new chat's choice moves to the conversation when it starts, and each conversation remembers its project on this computer.
- **Agents › Integrations › Projects.** Desktop only; this tab replaces Shared folders.
  - A description: projects are folders on this computer, picked per chat; commands are sandboxed; `.git` and `.env` are off limits; changes can be undone; other devices can read projects but never change them.
  - One row per project or read-only folder, with **Remove**.
  - Under a project: the **Package installs** switch, off by default, whose help text states the data risk, and up to five "Changes from <time>" rows with **Undo**.
  - Under a read-only folder: what it means, and **Allow changes**.
  - **Add a project** opens the system folder picker. When a folder is refused, the reason shows inline.
- **Answer actions.** Undo appears on an answer when its run used `code_write`, `code_edit`, `code_run` or `code_start` and its undo copy still exists. It confirms first, then shows "Changes to <project> undone".
- **Settings › Agents › Permissions.** Retitled **Projects**: the same list with one-line descriptions, and Remove, which also deletes the project's undo history.
- **Work lines.** Code tools read as plain phrases: "Ran a command", "Edited a file", "Opened a preview".

## Rules followed

These come from AGENTS.md:

- Monochrome only. Status is shown in words. Menus use checkmarks.
- No loading text. Lists appear once loaded and stay on screen while they refresh.
- Failures appear inline in plain language.

## Other devices

Projects are offered to the person's other devices read-only, as shared folders were: list, read and send files. Editing and commands happen only on the computer the project is on, since no device policy can grant the `code` surface.
