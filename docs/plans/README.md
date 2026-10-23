# Plans

Plans are temporary. A plan is how something will be built, what is left and how it is measured.
When the work ships, its facts move into the feature's folder as current truth, written as how
it works now, and the plan is deleted. Git keeps the history.

Every plan opens with two lines under its title:

```
Status: draft | active | shipped
Graduates to: docs/<feature>/
```

A plan with `Status: shipped` is waiting to be folded in and then deleted. Do not keep one
around as history, and do not write a plan for work that fits in a pull request description.

## In flight

| Plan | Graduates to |
| --- | --- |
| [agent-browser-actions.md](agent-browser-actions.md): a catalog of page actions, obstacles and a vision fallback | [agents](../agents/README.md) |
| [spaces-as-profiles.md](spaces-as-profiles.md): the build plan for Spaces as profiles (partly built) | [spaces](../spaces/README.md) |
| [extensions-sync-plan.md](extensions-sync-plan.md): extensions, ad blocking, passwords and sync | [kiri](../kiri/README.md) |
| [extensions-windows-test.md](extensions-windows-test.md): the Windows extension checklist | [kiri](../kiri/README.md) |
