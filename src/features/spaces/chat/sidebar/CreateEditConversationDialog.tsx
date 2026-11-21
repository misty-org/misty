import { spacesApi } from "../../api/api";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import type { SpaceConversation } from "../../api/dto/entities";
import {
  Button,
  ChoiceGroup,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ChoiceList,
  Input,
  Switch,
  Text,
} from "@misty/ui";
import { Hash, Lock, Volume2 } from "lucide-react";
import { useSpaceRoles } from "../../roles/useSpaceRoles";
import { allowedRoleIds, withPrivacy } from "../../roles/channelPrivacy";
import { isPrivateChannel } from "./conversationGroups";
import { useEffect, useState, type FormEvent } from "react";

/**
 * Creates or edits a channel: text or voice (when creating), its name, and whether it is private, seen
 * only by the roles picked (and whoever may manage channels), as in Discord.
 */
export function CreateEditConversationDialog({
  spaceId,
  open,
  onOpenChange,
  conversation,
  onSaved,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when renaming an existing channel; absent when creating one. */
  conversation?: SpaceConversation | null;
  onSaved: (conversation: SpaceConversation) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const roles = useSpaceRoles(spaceId);
  const defaultRoleId = roles?.find((role) => role.is_default)?.id ?? "";
  const pickable = (roles ?? []).filter((role) => !role.is_default);
  const [isPrivate, setPrivate] = useState(false);
  const [allowed, setAllowed] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setTitle(conversation?.title ?? "");
    setKind("text");
    setPrivate(Boolean(conversation && isPrivateChannel(conversation, defaultRoleId)));
    setAllowed(allowedRoleIds(conversation));
  }, [open, conversation, defaultRoleId]);

  const canSave = Boolean(title.trim()) && !saving;

  const close = () => {
    if (saving) return;
    onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const name = title.trim().slice(0, 80);
      let saved = conversation
        ? await spacesApi.updateConversation(spaceId, conversation.id, name)
        : await spacesApi.createConversation(spaceId, name, { voice: kind === "voice" });
      const wasPrivate = Boolean(conversation && isPrivateChannel(conversation, defaultRoleId));
      const before = allowedRoleIds(conversation).sort().join();
      if (
        defaultRoleId &&
        (isPrivate !== wasPrivate || (isPrivate && before !== [...allowed].sort().join()))
      )
        saved = await spacesApi.setChannelOverwrites(
          spaceId,
          saved.id,
          withPrivacy(saved.overwrites ?? [], defaultRoleId, isPrivate, allowed),
        );
      onSaved(saved);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The channel could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{conversation ? "Edit channel" : "New channel"}</DialogTitle>
          </DialogHeader>
          {conversation ? null : (
            <ChoiceGroup
              className="mt-5"
              label="Channel type"
              fill
              value={kind}
              onChange={setKind}
              options={[
                { value: "text", label: "Text", icon: Hash },
                { value: "voice", label: "Voice", icon: Volume2 },
              ]}
            />
          )}
          <Text bare as="label" tone="muted" weight="medium" className="mt-5 grid gap-2 text-xs">
            Name
            <Input
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Text>
          {defaultRoleId ? (
            <Text
              bare
              as="label"
              tone="default"
              weight="medium"
              className="mt-5 flex items-center justify-between gap-3 text-control"
            >
              <span className="flex items-center gap-2">
                <Lock aria-hidden="true" />
                Private channel
              </span>
              <Switch checked={isPrivate} onCheckedChange={setPrivate} />
            </Text>
          ) : null}
          {isPrivate && pickable.length ? (
            <ChoiceList
              className="mt-3"
              label="Roles that can see this channel"
              multiple
              options={pickable.map((role) => ({ value: role.id, label: role.name }))}
              selected={allowed}
              onSelect={(roleId) =>
                setAllowed((current) =>
                  current.includes(roleId)
                    ? current.filter((id) => id !== roleId)
                    : [...current, roleId],
                )
              }
            />
          ) : null}
          {error ? (
            <SystemErrorNotice
              error={error}
              scope={`social:conversation:${spaceId}`}
              title="Channel could not be saved"
            />
          ) : null}
          <DialogFooter className="mt-5">
            <Button variant="secondary" size="lg" type="button" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={!canSave}>
              {conversation ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
