# Chat and agents are separate (2026-10-16)

Decisions (user, 2026-10-16):

- Chat is people only: channels and direct messages between you and Space members.
- Agents are reached from chat by @mention. A mention starts a temporary run. Only the caller sees the run; everyone sees the agent's final reply posted in the chat.
- Any member's agent can be mentioned (agents are listed under their person). The asker is billed.
- Agents page stays at `/agents` with three lists: Projects, Conversations (was Recents), Mentions.
- Mentions is where the caller sees what an agent did to answer a chat message: steps, tools, files, outcome.
- Existing agent chats (made Space DMs by migration 20271025000000_agent_chats_are_space_dms) move back to Conversations. Chat keeps only channels and people.
- The chat icon (toolbar, sidebar bottom-right) opens the Space chat panel. Agents is reached from the ⌘T panel.

## Plan

1. Server: drop the agent-chat-to-Space-DM triggers; delete `direct_agent_id` DMs from `space_conversations`; keep `misty_ask_conversations` as the only store for agent chats. New migration, no edit to the old one.
2. Server: mention run. A message with `@agent` creates a run in a mention record (`space_message_id`, `agent_id`, `caller_user_id`), invisible to others. On finish, the agent posts one reply message into the chat as that agent. Billing to the caller (see Agents in Spaces v1).
3. Client Agents page: restore `/agents` (remove the redirect in `AgentsPage.tsx`), rename Recents to Conversations, add a Mentions list beside Projects, each row opening the run.
4. Client Chat: remove `AgentChatPane` and agent rows from `ChatSidebar`; add @mention autocomplete in the composer that lists members' agents; show "Working…" then the reply in the thread; a Mentions link on the caller's own mention opens the run in Agents.
5. Tests and design: update `DESIGN.md` for the agent panel and the chat sidebar; Mentions rows use `StatusTable` status words.

## Open questions

- What a mention costs when the agent needs approval or asks a question: the question goes to the caller in Mentions, and chat shows "Waiting for [caller]".
- Whether a mention can carry the message thread as context by default (assume the replied-to thread plus 20 recent messages).
