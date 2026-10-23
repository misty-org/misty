# Docs

- **`design/`** holds approved design briefs, one folder per surface, with their mockups. A brief
  is the source of truth for how that surface looks and behaves, and [AGENTS.md](../AGENTS.md)
  cites them by path. Each brief opens with its status (approved, built, superseded). Change a
  brief only when its direction changes, and say so in its status line.
- **`plans/`** holds current plans: how something is built or will be built, what is left, and
  how it is measured. [roadmap.md](plans/roadmap.md) is the one plan for where Misty is going;
  [agent-harness.md](plans/agent-harness.md) describes the agent as built today. A plan that is
  done or dropped is deleted, not kept as history; git keeps the history.
- The loose files are references: [settings-profiles.md](settings-profiles.md) (how settings
  are stored) and [misty-home-ledger.md](misty-home-ledger.md) (what lives in `~/.misty`).

Feature folders under `src/` may carry their own `DESIGN.md` for details that only matter there.
Images in `docs/` are git-ignored, so a doc never depends on a screenshot to make its point.
