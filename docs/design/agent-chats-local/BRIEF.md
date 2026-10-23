# Agent chats live on your device

Approved October 19, 2026. This brief supersedes the agents-on-devices brief (since removed;
its keep-awake rule moved to [devices/BRIEF.md](../devices/BRIEF.md)) and the cross-device agent
work in [devices/BRIEF.md](../devices/BRIEF.md). It keeps the
[agent architecture brief](../agent-architecture/BRIEF.md): the model loop stays on the
server runtime, and every model call goes through its AI SDK on Misty's keys.

## Why

Agent chats were stored in the server's Postgres and listed on every device, while each run
was bound to the device that started it, with its tabs held only there. A chat could show on
two devices while its browser was on one. Picking another device to work on added run grants
across devices, remote sessions, keep-awake on the other machine and per-device agent toggles,
just to support one picker. Claude Code and Codex keep a chat on the computer it started on.
Misty now does the same.

## Decisions

1. **No device picker.** An agent run works on the device the person sent it from. The
   composer has no Device chip, and grants only ever name the sending device. Each check
   refuses a grant that names another device: the server, the Rust grant check and the
   agent's own browser session.
2. **Chats live on the device.** Each conversation, with its messages, timelines, title,
   folder and read state, is saved in `misty.db` (`agent_chats`). It never syncs. Folders
   are local too.
3. **The server runs turns but keeps no transcript.**
   - Each turn carries the chat's earlier turns from the device (`history_turns`). The
     server fits them to the model's window, as it did with its own stored turns.
   - The server keeps a thin row per chat. It admits one run at a time, holds the chat's
     model choice and generated title, keeps the summary of older turns, and names the
     device that keeps the chat (`kept_on_device_id`).
   - A run's request and events are deleted when the run expires (24 hours), not kept for
     30 days. The device has the transcript by then.
4. **Chats Misty starts arrive in an inbox.** A chat started by email (+misty), Slack
   (@misty) or a schedule without a computer waits on the server with no device. The first
   device to load the Agents page takes it, and from then on it is that device's chat.
5. **Schedules run on the computer they were made on.** The schedule dialog says which
   computer; there is no picker. Missed runs still wait for that computer (roadmap C1).
6. **Older chats are copied once.** On its first launch after this change, each device
   copies every chat from before it (`legacy`). Those keep their 30-day retention on the
   server. A device that continues an older chat takes it.

## What stays on the server

- Billing and usage, the AI Gateway route and the run queue with its device jobs.
- Composio connections, agent memory, Space chat, and Mentions replies posted into Space
  chat.
- Files and artifacts, and attachments a turn sent to the model. These stay until the chat
  is deleted.
- Generated titles, which reach the device on the `conversation-titles` topic.

## What changes for people

- A chat shows only on the device that started it. Read dots are per device.
- If Misty quits mid-run and comes back more than 24 hours later, the run's reply is gone.
  The reply shows "This run stopped before it finished" and can be retried.
- A lost or wiped computer loses its chats. Export or backup is not built yet.
- Outside the desktop app there is no device to keep chats. The server lists them as before.

## Not changed

- Space @mentions: the run's detail in Mentions still comes from the server, and the reply
  is posted in the Space chat.
- The agent's own browser session on this computer (`browser.session`), its leases, Stop and
  keep-awake.
