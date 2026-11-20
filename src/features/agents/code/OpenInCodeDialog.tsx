import { CodeXml, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Surface,
  Text,
  useNotice,
} from "@misty/ui";
import { toolKey } from "../activity/stepSentences";
import type { GlobalAiMessage } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useChatFolder, useChatFolders } from "../shared-folders/chatFolder";
import { useProjectsHome, useProjectsHomePath } from "../shared-folders/projectsHome";
import { updateCodePageLayout } from "./codePageStore";

/**
 * The way a chat in its scratch folder becomes a project of its own on the Code page; the agent
 * can offer the same with a card in its reply.
 */
export function OpenInCodeButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        <CodeXml aria-hidden="true" />
        Open in Code
      </Button>
      <OpenInCodeDialog conversationId={conversationId} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** A chat's title as a project's folder name: `Build a todo app` becomes `build-a-todo-app`. */
export function projectNameFrom(title: string): string {
  const name = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return name || "project";
}

/**
 * "Open in Code": the chat's work becomes a project. It shows where the project goes (the
 * projects folder, or another folder picked for this one project) and its name from the chat;
 * opening moves the chat's scratch files there and opens the chat on the Code page.
 */
export function OpenInCodeDialog({
  conversationId,
  open,
  onOpenChange,
  suggestedName,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The name the agent proposed, used over the chat's title. */
  suggestedName?: string;
}) {
  const navigate = useNavigate();
  const home = useProjectsHomePath();
  const title = useMistyStore(
    (state) => state.conversations.find((chat) => chat.id === conversationId)?.title ?? "",
  );
  // A run in the chat works in its scratch folder, so the files can't move under it.
  const running = useMistyStore(
    (state) =>
      state.working &&
      (state.activeConversationId === conversationId ||
        state.invocationConversationId === conversationId),
  );
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  useEffect(() => {
    if (!open) return;
    setName(projectNameFrom(suggestedName?.trim() || title));
    setPicked(null);
    setError("");
    // Only when it opens: a title that changes meanwhile keeps the name being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const location = picked ?? home ?? "";
  const report = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : String(reason));

  // With no projects folder yet, the one chosen here becomes it; otherwise it is for this project.
  const change = () => {
    setBusy(true);
    const pick = home
      ? useChatFolders.getState().pickProjectParent()
      : useProjectsHome.getState().choose();
    void pick
      .then((path) => {
        if (path && home) setPicked(path);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const confirm = async () => {
    if (busy || running || !location || !name.trim()) return;
    setBusy(true);
    try {
      await useChatFolders.getState().openInCode(conversationId, location, name);
      onOpenChange(false);
      // Open beside the Code page's editor (not through the chat column's module, which shows
      // replies and so this card: the two would import each other).
      updateCodePageLayout({ chat: conversationId });
      if (useMistyStore.getState().activeConversationId !== conversationId)
        useMistyStore.getState().selectConversation(conversationId);
      void navigate("/agents?view=code");
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-110">
        <DialogHeader>
          <DialogTitle className="text-sm">Open in Code</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="open-in-code-name" className="text-2xs">
              Name
            </Label>
            <Input
              id="open-in-code-name"
              value={name}
              autoFocus
              className="text-ui"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void confirm();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-2xs">Location</Label>
            <div className="flex min-w-0 items-center gap-2">
              <Surface tone="well" radius="md" className="min-w-0 flex-1 px-3 py-2">
                <Text size="meta" tone={location ? "default" : "muted"} as="div">
                  {location || "No projects folder yet"}
                </Text>
              </Surface>
              <Button variant="secondary" disabled={busy} onClick={change}>
                <FolderOpen aria-hidden="true" />
                {location ? "Change…" : "Choose…"}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="quiet" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || running || !location || !name.trim()}
            onClick={() => void confirm()}
          >
            Open in Code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The `open_in_code` call in a reply's steps, as the agent's tool server names it. */
function openInCodeOffer(message: GlobalAiMessage): { name?: string; why?: string } | null {
  for (const item of message.progress ?? []) {
    // Engines spell it their own way: `mcp__misty__open_in_code`, `misty_open_in_code`.
    if (item.type !== "tool" || !toolKey(item.name).endsWith("open_in_code")) continue;
    const args = (item.args ?? {}) as { name?: unknown; why?: unknown };
    return {
      name: typeof args.name === "string" ? args.name : undefined,
      why: typeof args.why === "string" ? args.why : undefined,
    };
  }
  return null;
}

/**
 * The agent's offer to move its chat into Code, under its reply: why, in its words, and the
 * button that opens the same choice as the chat's own Open in Code. Gone once the chat is Code's.
 */
export function OpenInCodeCard(props: { conversationId: string; message: GlobalAiMessage }) {
  const offer = useMemo(() => openInCodeOffer(props.message), [props.message]);
  const { kind, loaded } = useChatFolder(props.conversationId);
  const [open, setOpen] = useState(false);
  if (!offer || !loaded || kind === "project") return null;
  return (
    <Surface
      as="section"
      tone="card"
      edge="hairline"
      radius="xl"
      className="mt-3 grid max-w-[85%] gap-2 px-3.5 py-3"
      aria-label="Open in Code"
    >
      <Text
        as="p"
        bare
        size="meta"
        weight="medium"
        tone="default"
        className="m-0 flex items-center gap-1.5"
      >
        <Text bare tone="muted" className="flex flex-none">
          <CodeXml aria-hidden="true" />
        </Text>
        This is becoming a project
      </Text>
      {offer.why ? (
        <Text size="meta" tone="muted" wrap>
          {offer.why}
        </Text>
      ) : null}
      <div className="flex items-center gap-2">
        <Button onClick={() => setOpen(true)}>Open in Code</Button>
      </div>
      <OpenInCodeDialog
        conversationId={props.conversationId}
        open={open}
        onOpenChange={setOpen}
        suggestedName={offer.name}
      />
    </Surface>
  );
}
