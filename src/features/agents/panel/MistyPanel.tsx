import { useAgentAccountId } from "../personal/agentAccount";
import { openMistyConversationInNewTab } from "../conversations/ask/handoff";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useSettingsStore } from "@/features/settings";
import { IconButton } from "@/shared/ui";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "../page/agentsWorkspace.css";
import "../methods/agentWorkspaceFrame.css";
import "./mistyPanel.css";
import { AgentWorkspaceConversation } from "../conversations/view/AgentWorkspaceConversation";
import { AgentConversationHeading } from "../page/AgentConversationHeading";
import { PanelConversationPicker } from "./PanelConversationPicker";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { MISTY_PANEL_WIDTH, useMistyPanelStore } from "./mistyPanelStore";
import { AgentBrowserPip } from "../agent-browser/AgentBrowserPip";
import { setBrowserExpanded } from "../agent-browser/agentBrowserStore";

export type MistyPanelSide = "left" | "right";

/**
 * The chat panel beside the workspace, so an agent (and, once chats live in Spaces, a
 * friend) is one keystroke away from any page. Expanding it opens the full chat page.
 */
export function MistyPanel({ side: propSide }: { side?: MistyPanelSide } = {}) {
  const settingsAgent = useSettingsStore((s) => s.settings?.document.agent) as
    { panel_side?: string } | undefined;
  const side = propSide ?? (settingsAgent?.panel_side === "left" ? "left" : "right");
  const accountId = useAgentAccountId();
  const { agents, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [chatRevision, setChatRevision] = useState(0);
  const [draftSeed, setDraftSeed] = useState({ agentId: "", text: "" });
  const root = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLButtonElement>(null);
  const workingAgentId = useMistyStore((s) => s.selectedAgentId);
  const conversations = useMistyStore((s) => s.conversations);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  useEffect(() => {
    void load(accountId);
  }, [accountId, load]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(accountId);
    if (accountId) void store.loadConversations();
  }, [accountId]);
  useEffect(() => {
    root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, []);
  const profile =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.id === workingAgentId) ??
    agents.find((a) => a.engine && a.enabled) ??
    agents.find((a) => a.system_managed) ??
    agents[0];
  const conversation = conversations.find(
    (c) =>
      c.id === activeConversationId &&
      (c.agentId === profile?.id || (!c.agentId && profile?.system_managed)),
  );
  const close = () => useMistyPanelStore.getState().setOpen(false);
  // The full page opens in a new tab; this panel stays as it is.
  const openInAgents = () => openMistyConversationInNewTab();
  const select = (id: string, startNew = false, conversationId?: string, prompt = "") => {
    setChatRevision((n) => n + 1);
    setSelected(id);
    setDraftSeed({ agentId: id, text: prompt });
    const nextConversationId = startNew ? "" : (conversationId ?? "");
    useMistyStore.setState({
      selectedAgentId: id,
      activeConversationId: nextConversationId,
      query: prompt,
      context: [],
      handoff: undefined,
    });
    if (nextConversationId) void useMistyStore.getState().selectConversation(nextConversationId);
  };
  return (
    <aside
      ref={root}
      className="agents-workspace relative h-full shrink-0 overflow-hidden"
      // The dock sets the width; it stays fixed while the dock slides, so the panel
      // slides in from the edge instead of squeezing.
      style={{ width: `var(--misty-panel-width, ${MISTY_PANEL_WIDTH}px)` }}
      aria-label="Chat"
      data-misty-panel={side}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
    >
      <div className="agent-studio h-full w-full">
        <div className="agent-studio-canvas flex h-full flex-col">
          <div className="agent-studio-task flex h-full min-h-0 flex-1 flex-col">
            <div className="agents-main h-full">
              <div className="agents-body h-full">
                <div className="agents-chat">
                  <AgentConversationHeading
                    conversation={conversation}
                    switcher={{
                      agents,
                      conversations,
                      selectedAgent: profile,
                      conversationId: activeConversationId,
                      disabled: false,
                      restoreTriggerFocus: true,
                      triggerRef: identityRef,
                      onSelect: select,
                      onSettings: openInAgents,
                    }}
                    disabled={false}
                    panelPicker={
                      <PanelConversationPicker
                        accountId={accountId}
                        agentId={profile?.id}
                        includeUnassigned={profile?.system_managed}
                        title={conversation?.title}
                        onSelect={(id) => profile && select(profile.id, false, id)}
                        onNew={() => profile && select(profile.id, true)}
                        onViewAll={openInAgents}
                      />
                    }
                    actions={
                      <>
                        <IconButton label="Open full chat" onClick={openInAgents}>
                          <ArrowUpRight />
                        </IconButton>
                        <IconButton label="Close chat" onClick={close}>
                          <X />
                        </IconButton>
                      </>
                    }
                  />
                  {/* The chat's agent browser as a picture; the split opens on the Agents page. */}
                  <AgentBrowserPip
                    always
                    conversationId={conversation?.id}
                    onExpand={() => {
                      if (conversation?.id) setBrowserExpanded(conversation.id, true);
                      openInAgents();
                    }}
                  />
                  <AgentWorkspaceConversation
                    key={`${accountId}:${profile?.id}:${chatRevision}`}
                    agent={profile}
                    spaceId=""
                    accountId={accountId}
                    emptyContent={
                      profile ? (
                        <div className="agent-studio-welcome">
                          <h1>What can I do for you?</h1>
                        </div>
                      ) : undefined
                    }
                    initialDraft={
                      !activeConversationId && draftSeed.agentId === profile?.id
                        ? draftSeed.text
                        : ""
                    }
                    onCreate={openInAgents}
                    onNewChat={() => profile && select(profile.id, true)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
