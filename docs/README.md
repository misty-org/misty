# Misty docs

Misty is your browser, private and made your own, open source, with any model you bring.
Agents work in your browser, on your computer, signed in as you, and you can watch them. The
browser comes first and has to be worth using with no AI at all. [roadmap.md](roadmap.md) says
where Misty is going and why.

Misty is open source under the AGPL-3.0, with no hosted service and no billing. [self-hosting.md](self-hosting.md) runs the server,
[byok.md](byok.md) explains model keys and [cloudflare.md](cloudflare.md) deploys the optional
Workers to your own Cloudflare account.

## Find a feature

Each feature has one folder. Start with its `README.md`: what it is, where its code lives and
which file answers which question. It also holds that feature's interface rules.

| Feature | Folder |
| --- | --- |
| Agents: harness, browser, chats, cursor companion, evals | [agents/](agents/README.md) |
| Spaces: owner and members, switching, color | [spaces/](spaces/README.md) |
| Sync, devices and the shared clipboard | [sync/](sync/README.md) |
| Voice, notes and memory | [voice-memory/](voice-memory/README.md) |
| Browser: tabs, media controls, platform limits | [browser/](browser/README.md) |
| Kiri: the native web platform layer, and extensions | [kiri/](kiri/README.md) |
| Settings and the `~/.misty` home | [settings/](settings/README.md) |
| Interface rules shared by every surface | [ui/](ui/README.md) |
| Competitors | [competitors.md](competitors.md) |

Work that is not built yet is in [plans/](plans/README.md). [research/](research/) holds
one-off investigations. Feature folders under `src/` may carry their own `DESIGN.md` for
details that only matter next to that code.

## Keeping docs current

- A feature folder says how the feature works now. Change the doc in the same pull request that
  changes the behavior.
- When a plan ships, fold it into the feature's folder and delete the plan. Delete a dropped
  plan or an outdated doc instead of archiving it.
- Link to other docs by relative path, and to code by path only. Do not copy code into docs.
- Approved briefs open with their status line. Change a brief only when its direction changes.
- Images in `docs/` are git-ignored, so a doc never depends on a screenshot to make its point.
