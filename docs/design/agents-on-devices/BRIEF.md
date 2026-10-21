# Agents on devices — superseded

> Superseded on October 19, 2026 by [agent-chats-local/BRIEF.md](../agent-chats-local/BRIEF.md):
> there is no device picker, and an agent run works only on the device it was sent from. The
> keep-awake setting below still applies to that device.


Approved October 10, 2026, with the owner's answers to the proposal's questions. It is Phase 6 of
[docs/plans/agentic-browser.md](../../plans/agentic-browser.md) and builds on the
[devices brief](../devices/BRIEF.md) (admission, signed policy records, run grants) and the
[agent architecture brief](../agent-architecture/BRIEF.md) (one loop on the server runtime).

## Goal

Ask from any device, and choose which of your devices the agent works on. From your laptop you can
have the agent fill in a form in the Mac mini's browser; it keeps working there while you do
something else, and the Mac mini stays awake while it does.

## Decisions

1. **No home devices.** An agent isn't tied to a device. Each request names the device it works on;
   the default is the device you're asking from.
2. **Only online devices can be picked.** The picker lists your added devices whose policy lets
   agents use their browser or folders; offline ones are shown but can't be picked. A device that
   looked online but doesn't answer, or drops out mid-task, ends the step with a plain message to
   pick another device. Nothing waits silently and nothing moves to another device on its own.
3. **Computers stay awake for agents.** An account setting, on by default: while an agent is
   working on a computer, Misty keeps it from idling to sleep. The display may still turn off.

## Rules

- **The loop stays on the server.** The chosen device runs jobs; it never runs the model loop.
- **The asking device authorizes, the chosen device decides.** Your device signs a run grant that
  names the chosen device and lets the agent open a session there (`browser.session`). The chosen
  device checks that grant and its own signed policy before opening anything, opens the session
  under its own native lease, and signs the grants for its own tabs. The server carries all of it
  and can forge none of it.
- **Other agents' words are data.** Sub-agents and other members' agents never grant authority.
- **Files stay on the LAN**, as before.

## How a run works on another device

1. You pick "Mac mini" in the composer. Your device signs grants for the Mac mini's folders and
   browser, including `browser.session`.
2. When the agent needs a browser, `screen_open` asks the Mac mini to open a session: a device job
   on its browser grant. If the Mac mini isn't online, or doesn't take the job within 30 seconds,
   the agent says so and asks you to pick another device.
3. The Mac mini opens an agent tab (hidden, like sub-agent tabs), holds a native lease for it,
   keeps itself awake if the setting is on, shows "<agent> is working here for <your device>" with
   Stop, and returns the tab with grants it signed itself.
4. Your device continues the conversation with that tab attached. Every browser step is a job
   for the Mac mini, checked there against the tab's lease and grants.
5. The session ends when you press Stop on either device, when the run is canceled, or after 10
   minutes without work. Follow-ups in the same conversation within that time reuse the tab.

Sub-agents a run starts open their tabs on the device where its session runs, under the same lease.

## Threats and answers

| Threat | Answer |
|---|---|
| Server opens a session on a device you didn't pick | The device needs your device's signed `browser.session` grant naming it, and its own policy must allow agents in its browser. |
| Server drives a tab on the chosen device without a session | Each step needs the tab's own grant, signed by that device, and a live native lease for its task. |
| The chosen device goes offline mid-task | The step fails as not attempted; the run ends with "pick another device". |
| A session outlives the request | Stop on either device, cancellation, and a 10-minute idle limit end it; leases expire on their own. |
| Keep-awake drains a laptop | It applies only while an agent is working there, and the setting turns it off. |

## Tests

A session-start job without a grant naming the device, or with a device policy that refuses the
browser, is refused on the device. A step for a tab whose session ended is refused. An offline
device is not offered and a silent one ends the step with the pick-another-device message. Keep
awake is held only while work runs and released after.
