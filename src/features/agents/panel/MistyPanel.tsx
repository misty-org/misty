import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { showMistyConversation } from "@/features/misty/handoff";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useSettingsStore } from "@/features/settings";
import { IconButton } from "@/shared/ui";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "../agentsWorkspace.css";
import "../workspace/agentWorkspaceFrame.css";
import "./mistyPanel.css";
import { AgentWorkspaceConversation } from "../components/AgentWorkspaceConversation";
import { AgentConversationHeading } from "../page/AgentConversationHeading";
import { AgentLanding } from "../page/AgentLanding";
import { AgentNewChat } from "../page/AgentNewChat";
import { usePersonalAgentsStore } from "../personalAgentsStore";
import { useMistyPanelStore } from "./mistyPanelStore";

export type MistyPanelSide = "left" | "right";

export const MISTY_PANEL_WIDTH = 400;

/**
 * The Agents conversation beside the workspace, so Misty is one keystroke away from any
 * tool. It is the Agents page's own title bar, conversation and landing in one column;
 * anything beyond that (Activity, Templates, agent settings) opens the Agents page.
 */
export function MistyPanel({
  side: propSide,
  background,
}: {
  side?: MistyPanelSide;
  /** The adjacent page's color, so the panel reads as the page extended. */
  background?: string;
} = {}) {
  const settingsAgent = useSettingsStore((s) => s.settings?.document.agent) as
    { panel_side?: string } | undefined;
  const side = propSide ?? (settingsAgent?.panel_side === "left" ? "left" : "right");
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const { agents, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [newChat, setNewChat] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [chatRevision, setChatRevision] = useState(0);
  const [draftSeed, setDraftSeed] = useState({ agentId: "", text: "" });
  const root = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLButtonElement>(null);
  const recipientInputRef = useRef<HTMLInputElement>(null);
  const working = useMistyStore((s) => s.working);
  const workingAgentId = useMistyStore((s) => s.selectedAgentId);
  const conversations = useMistyStore((s) => s.conversations);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  useEffect(() => {
    if (!accountId) {
      void load("");
      return;
    }
    return observeAccountChanges(accountId, ["agents"], () => load(accountId));
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
    agents.find((a) => a.system_managed) ??
    agents[0];
  const conversation = conversations.find(
    (c) =>
      c.id === activeConversationId &&
      (c.agentId === profile?.id || (!c.agentId && profile?.system_managed)),
  );
  const close = () => useMistyPanelStore.getState().setOpen(false);
  const openInAgents = () => {
    showMistyConversation();
    close();
  };
  const select = (id: string, startNew = false, conversationId?: string, prompt = "") => {
    setChatRevision((n) => n + 1);
    setSelected(id);
    setNewChat(false);
    setDraftSeed({ agentId: id, text: prompt });
    const nextConversationId = startNew ? "" : (conversationId ?? "");
    useMistyStore.setState({
      selectedAgentId: id,
      activeConversationId: nextConversationId,
      query: prompt,
      context: [],
      handoff: undefined,
      browserRequest: undefined,
    });
    if (nextConversationId) void useMistyStore.getState().selectConversation(nextConversationId);
  };
  return (
    <aside
      ref={root}
      className="agents-workspace relative h-full shrink-0 overflow-hidden"
      style={{ width: MISTY_PANEL_WIDTH, ...(background ? { background } : {}) }}
      aria-label="Misty"
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
                <div className="agents-chat" data-scroll-root>
                  <AgentConversationHeading
                    newChat={newChat}
                    conversation={conversation}
                    recipientSearch={recipientSearch}
                    recipientInputRef={recipientInputRef}
                    switcher={{
                      agents,
                      conversations,
                      selectedAgent: profile,
                      conversationId: activeConversationId,
                      disabled: working,
                      restoreTriggerFocus: true,
                      triggerRef: identityRef,
                      onSelect: select,
                      onCreate: openInAgents,
                      onSettings: openInAgents,
                    }}
                    disabled={working}
                    onRecipientSearch={setRecipientSearch}
                    onCloseNewChat={() => setNewChat(false)}
                    onNewChat={() => {
                      setNewChat(true);
                      setRecipientSearch("");
                    }}
                    actions={
                      <>
                        <IconButton label="Open in Agents" onClick={openInAgents}>
                          <ArrowUpRight />
                        </IconButton>
                        <IconButton label="Close Misty" onClick={close}>
                          <X />
                        </IconButton>
                      </>
                    }
                  />
                  {newChat ? (
                    <AgentNewChat
                      agents={agents}
                      search={recipientSearch}
                      onCreate={openInAgents}
                      onSelect={(id) => select(id, true)}
                    />
                  ) : (
                    <AgentWorkspaceConversation
                      key={`${accountId}:${profile?.id}:${chatRevision}`}
                      agent={profile}
                      spaceId=""
                      accountId={accountId}
                      showControlBar
                      initialDraft={
                        !activeConversationId && draftSeed.agentId === profile?.id
                          ? draftSeed.text
                          : ""
                      }
                      belowComposer={
                        profile ? (
                          <AgentLanding
                            accountId={accountId}
                            agentId={profile.id}
                            onConversation={(id) => select(profile.id, false, id)}
                            onUseTemplate={(prompt) => select(profile.id, true, undefined, prompt)}
                            onActivity={openInAgents}
                            onTemplates={openInAgents}
                          />
                        ) : undefined
                      }
                      onCreate={openInAgents}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
