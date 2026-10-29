# Design: Misty Agents

Agents opens straight into the selected agent's New task conversation. Conversations themselves follow [docs/agents/mockups/chat.html](../../../docs/agents/mockups/chat.html/); the companion has its own [DESIGN.md](companion/DESIGN.md). This file covers the Agents page around them.

## Colors

Use Misty's semantic charcoal/cream tokens. Status uses text, icons and contrast: no colored status dots (except the Recents dots AGENTS.md allows), tinted selections or accent-colored focus rings. Cloud avatar colors are identity artwork, not status. Connected apps and coding tools show their official `BrandIcon` logos; everything around them stays monochrome.

## Entry

`/agents` opens the selected agent's New task conversation: the agent in the URL, else the last-used agent, else Misty, else the first agent. There is no directory page and no Back control.

- **Sidebar:** the agent switcher, then New task, Workflows, Mentions and Integrations, then Projects and Recents. No footer.
- **Switcher:** agents with a checkmark on the current one, conversations only while searching, then New agent and the selected agent's settings. Selecting another agent goes through the draft and profile guards and is disabled while recording, uploading, saving or running.
- **Empty composer:** the launch prompt and the composer with its strip, and nothing else: no suggestions, pills or recent work. The folder control appears above the composer only while a folder is in progress.
- **Header:** the conversation title only. A quiet Working status ends the title bar while a task runs. Rename and Delete live on the Recents row's ⋯ menu.
- **No side panel:** the conversation has no Details, Task, Sources or Files panel and no Activity page. Goal sits under the composer's mode menu and opens a dialog with the goal and the approved plan's live checklist.

## Sidebar rows

Recents rows have no repeated chat glyph; their overflow menu appears on hover, on focus, on the current conversation or while open, and right-click opens the same actions. Projects (stored as conversation folders) sit above Recents under quiet muted labels; their conversations hang off them with `TreeBranch`. Conversations move between projects and Recents by dragging (Alt+Shift+Up/Down from the keyboard), never from a menu. Long titles fade at the trailing edge. The sidebar's trailing edge resizes it (200–420px, remembered per device; double-click resets). A Get started card sits at the foot of the sidebar, ticks steps off from what the account has done, collapses per device and goes away once every step is done.

Rename uses a focused shared dialog; Delete asks for confirmation and explains that deletion is permanent and drops the draft. Failures keep the dialog open for retry. A running response must stop before its conversation is deleted.

## Composer

The message box is one row (attach, text, voice, send; `MistyComposer layout="inline"`), with its controls in one quiet strip beneath it (`components/ComposerStrip.tsx`). Chips are labeled, have no chevrons, and brighten on hover or while their menu is open. Menus carry no helper copy.

- **Order:** Project, Mode and Code, left to right. Models and reasoning effort are chosen in Settings › Models, not in the composer.
- **Project:** projects on this computer only. Coding is independent of it.
- **Mode:** Manual, Auto, Plan and Teach as checkmarked choices, then Goal. Shift+Tab switches modes. Plan gives the composer a dashed frame and a "Plan with…" placeholder.
- **Code:** the conversation's coding tool, with or without a project: Settings default, then each tool with its logo (`CodingToolIcon`). Tools not installed or signed in are listed but can't be picked, with the reason in words. "Manage tools" opens Settings › Coding tools.
- **Narrow (the Misty panel, a container narrower than 560px):** every chip shows only its icon; names stay in tooltips and for assistive technology.
- **Control bar:** sits on top of the composer as a tab behind its top edge and holds folder work. Screens open on demand, so there is no work-location choice.

Enter submits; Shift+Enter inserts a line break; composition events never submit early.

## Answers and progress

Each prompt's replies form one turn. The last visible reply renders as the answer with its citations and actions; above it the turn shows its work: what Misty said while working as ordinary prose, and each run of consecutive tools folded into one muted row ("Used 3 tools (1 failed)", or the single tool's own words) that opens to its steps. Working text shimmers. Replies loaded from history fetch their timeline once from `GET /ai/invocations/{id}/progress`. Source: `progress/` and `components/conversationTurns.ts`.

Answers offer Copy, Reply, Good/Bad response and Read aloud, plus Try again on a retryable failure; prompts offer Copy, Edit as new message and Ask again. Ratings fill their glyph rather than adding color. Replies render through the shared `MistyMarkdown`; raw HTML never renders and people's own messages stay plain text.

## Plans, questions and goals

- **Question card:** above the composer, one question at a time with "n of m". Options are rows with a checkmark plus an Other field. Number keys pick, Enter advances or submits, Esc collapses it. Typing a message instead supersedes the questions.
- **Proposed plan:** a card at the end of the transcript with numbered steps; risk is an icon and a word, never color. Actions: Run plan (primary), Edit, Keep planning and Dismiss. Edited plans save as a new version.
- **Goal:** the objective, its status in words, the continuation count, a budget bar, "Done when" with proof, and the latest report, with Pause, Resume, Double budget and resume, Clear goal and New goal. Turns Misty starts toward a goal read as a quiet "Continued toward the goal" label.
- **Commands:** `/plan [message]` switches to Plan mode; `/goal <objective>` sets a goal and starts it.

## Workflows and Integrations

- **Workflows:** one page. Saved workflows (templates included) list first, then a "Start from an example" gallery with category chips. A workflow owns at most one schedule: any number of rules in one timezone, plus skipped dates, inputs and an on/off switch; scheduled runs use the latest version. Rows show the schedule in words and the next run. A workflow works with connected apps or in this Misty window.
- **Integrations:** chip tabs for Apps, Skills and Projects (Projects on desktop only). Apps are tiles with connected apps first; a tile opens a popup card with that app's accounts (Reconnect, Disconnect, Add account).
