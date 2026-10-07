import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import "@fontsource-variable/inter";
import "@/styles/styles.css";
import "@/styles/App.css";
import { AuthContext } from "@/features/auth/authState";
import { SpaceOverview } from "@/features/spaces/SpaceOverview";
import { SpaceOverviewProvider } from "@/features/spaces/useSpaceOverview";
import { SpaceWorkspaceRail } from "@/features/spaces/components/SpaceWorkspaceRail";
import { ConversationSwitcher } from "@/features/spaces/chat/components/ConversationSwitcher";
import { space, conversations } from "./productionData";
import { Button, TooltipProvider } from "@/shared/ui";
import type { SpaceMessage, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { ChatMessageRow } from "@/features/spaces/chat/components/ChatMessageRow";
import type { SpaceChatMessagesProps } from "@/features/spaces/chat/components/ChatMessages";
import { DeleteMessageDialog } from "@/features/spaces/chat/components/DeleteMessageDialog";
import { SpaceChatComposer } from "@/features/spaces/chat/components/SpaceChatComposer";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useChatSuggestions } from "@/features/spaces/chat/hooks/useChatSuggestions";
import { useComposerInput } from "@/features/spaces/chat/hooks/useComposerInput";
const fixtureUser = { id: "me", name: "You", email: "you@example.invalid" };
const unavailable = async (): Promise<never> => {
  throw new Error("Account actions are unavailable in this fixture.");
};
const fixtureAuth = {
  user: fixtureUser,
  accounts: [],
  transitioning: false,
  setUser: unavailable,
  refreshUser: async () => fixtureUser,
  authenticateAccount: unavailable,
  switchAccount: unavailable,
  resumeAccount: unavailable,
  removeAccount: unavailable,
  logout: unavailable,
};
const member: SpaceMember = {
  space_id: "preview",
  user_id: "sam",
  name: "Sam Rivera",
  email: "sam@example.invalid",
  role: "member",
  joined_at: "2026-09-30T10:00:00Z",
  read_message_seq: 0,
};
const message = (
  id: string,
  name: string,
  text: string,
  patch: Partial<SpaceMessage> = {},
): SpaceMessage => ({
  id,
  space_id: "preview",
  seq: Number(id),
  sender_user_id: name === "You" ? "me" : "sam",
  sender_name: name,
  sender_kind: "person",
  content: [{ type: "text", text }],
  file_node_ids: [],
  created_at: `2026-09-30T17:0${id}:00Z`,
  ...patch,
});
const fixtures = [
  message("1", "Sam Rivera", "Saturday at 10? We can meet by the north entrance."),
  message("2", "You", "That works. I’ll bring the picnic blanket.", {
    reply_to_message_id: "1",
    reactions: [{ emoji: "👍", count: 2, reacted_by_me: true }],
  }),
  message("3", "Sam Rivera", "We’re in! I can bring coffee and something for breakfast."),
  message("4", "You", "I’ll add the packing list this evening."),
];
function ProductionPreview() {
  const location = useLocation();
  const conversationId = new URLSearchParams(location.search).get("conversation") ?? "";
  const [messages, setMessages] = useState(fixtures);
  const [editing, setEditing] = useState("");
  const [editText, setEditText] = useState("");
  const [deleting, setDeleting] = useState<SpaceMessage>();
  const [readOnly, setReadOnly] = useState(false);
  const [notice, setNotice] = useState("");
  const draft = useSpaceChatDraft("production-preview", conversationId);
  const suggestions = useChatSuggestions({
    spaceId: "preview",
    members: [member],
    currentUserId: "me",
    canBrowseLibrary: false,
    canReadLibrary: false,
    selectedLibraryIds: draft.selectedLibraryIds,
    attachmentSlotsLeft: draft.attachmentSlotsLeft,
  });
  const input = useComposerInput({
    draft,
    suggestions,
    canWriteMessages: !readOnly,
    canUploadAttachments: false,
    canBrowseLibrary: false,
    openPicker: () => {},
  });
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const props: SpaceChatMessagesProps = {
    spaceId: "preview",
    messages,
    currentUserId: "me",
    isOwner: false,
    canWrite: !readOnly,
    error: "",
    loading: false,
    editingMessageId: editing,
    editingText: editText,
    editSaving: false,
    nodes: [],
    libraryItems: [],
    canCopyLibrary: false,
    canAddToLibrary: false,
    endRef,
    scrollRef,
    onScroll: () => {},
    onEditingText: setEditText,
    onCancelEditing: () => setEditing(""),
    onSaveEdited: (e, m) => {
      e.preventDefault();
      setMessages((all) =>
        all.map((x) =>
          x.id === m.id
            ? {
                ...x,
                content: [{ type: "text", text: editText }],
                edited_at: new Date().toISOString(),
              }
            : x,
        ),
      );
      setEditing("");
    },
    onReply: (id) => draft.setReplyToMessageId(id),
    onToggleReaction: (m, emoji, reacted) =>
      setMessages((all) =>
        all.map((x) =>
          x.id === m.id
            ? {
                ...x,
                reactions: [
                  ...(x.reactions ?? []).filter((r) => r.emoji !== emoji),
                  {
                    emoji,
                    count:
                      ((x.reactions ?? []).find((r) => r.emoji === emoji)?.count ?? 0) +
                      (reacted ? -1 : 1),
                    reacted_by_me: !reacted,
                  },
                ],
              }
            : x,
        ),
      ),
    onBeginEditing: (m) => {
      setEditing(m.id);
      setEditText(m.content.map((s) => (s.type === "text" ? s.text : s.label)).join(""));
    },
    onDelete: setDeleting,
    onOpenNode: () => {},
    onError: setNotice,
    onLibraryItem: () => {},
    onReload: () => {},
  };
  return (
    <main
      className="flex h-full min-w-0 flex-col bg-charcoal-bg text-cream"
      data-theme="monochrome"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-charcoal-border px-5">
        <ConversationSwitcher
          spaceId="preview"
          conversation={conversations.find((c) => c.id === conversationId)}
          currentUserId="me"
          members={[member]}
          canWrite={!readOnly}
        />
        <Button variant="ghost" size="sm" onClick={() => setReadOnly((v) => !v)}>
          {readOnly ? "Restore writing" : "Test read-only"}
        </Button>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
        {messages.map((m) => (
          <ChatMessageRow
            key={m.id}
            message={m}
            compact={false}
            dateLabel={m.id === "1" ? "Wednesday, September 30" : undefined}
            avatarUrl=""
            repliedToMessage={messages.find((x) => x.id === m.reply_to_message_id)}
            repliedToAvatarUrl=""
            props={props}
          />
        ))}
      </div>
      {readOnly ? (
        <p className="p-5 text-center text-sm text-cream-muted">
          You can read this conversation, but you cannot send messages.
        </p>
      ) : (
        <SpaceChatComposer
          draft={draft}
          suggestions={suggestions}
          input={input}
          isConversation={false}
          canUploadAttachments={false}
          canBrowseLibrary={false}
          replyToSenderName={
            messages.find((m) => m.id === draft.replyToMessageId)?.sender_name ?? ""
          }
          mentionNames={["Sam Rivera"]}
          onOpenPicker={() => {}}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.isEmpty) return;
            setMessages((all) => [
              ...all,
              message(String(all.length + 1), "You", draft.text, {
                reply_to_message_id: draft.replyToMessageId,
                created_at: new Date().toISOString(),
              }),
            ]);
            draft.reset();
          }}
        />
      )}
      <p className="border-t border-charcoal-border px-5 py-2 text-xs text-cream-muted">
        Production components · Fixture data · No account mutations{notice && ` · ${notice}`}
      </p>
      <DeleteMessageDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        onConfirm={() => {
          setMessages((all) => all.filter((m) => m.id !== deleting?.id));
          setDeleting(undefined);
        }}
      />
    </main>
  );
}
function PreviewShell() {
  const location = useLocation();
  const all = location.pathname.endsWith("/home");
  return (
    <SpaceOverviewProvider accountId="me" space={space}>
      <div className="flex h-dvh min-w-0 bg-charcoal-bg text-cream">
        <div className="h-full shrink-0">
          <SpaceWorkspaceRail activeSpaceId="preview" section={all ? "home" : "social"} />
        </div>
        <div className="min-w-0 flex-1">
          {all ? <SpaceOverview space={space} /> : <ProductionPreview />}
        </div>
      </div>
    </SpaceOverviewProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/spaces/preview/social/misty"]}>
    <AuthContext.Provider value={fixtureAuth}>
      <TooltipProvider>
        <PreviewShell />
      </TooltipProvider>
    </AuthContext.Provider>
  </MemoryRouter>,
);
