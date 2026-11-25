import { spacesApi } from "../../api/api";
import { SystemErrorNotice } from "@/shared/platform/system_errors";
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
  OptionSelect,
  Switch,
  Text,
} from "@misty/ui";
import { Hash, Lock, Volume2 } from "lucide-react";
import { useSpaceRoles } from "../../roles/use_space_roles";
import { allowedRoleIds, withPrivacy } from "../../roles/channel_privacy";
import { isPrivateChannel } from "./conversation_groups";
import { channelLayout, channelsIn } from "./channel_layout";
import { useSpaceConversations } from "./use_space_conversations";
import { useEffect, useState, type FormEvent } from "react";

export function CreateEditConversationDialog({
  spaceId,
  open,
  onOpenChange,
  conversation,
  categoryId: startCategory = null,
  onSaved,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation?: SpaceConversation | null;
  categoryId?: string | null;
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
  const { conversations, categories } = useSpaceConversations(spaceId);
  const [category, setCategory] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setTitle(conversation?.title ?? "");
    setKind("text");
    setPrivate(Boolean(conversation && isPrivateChannel(conversation, defaultRoleId)));
    setAllowed(allowedRoleIds(conversation));
    setCategory((conversation ? conversation.category_id : startCategory) ?? "");
  }, [open, conversation, defaultRoleId, startCategory]);

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
      const known = categories.some((item) => item.id === category) ? category : "";
      let saved = conversation
        ? await spacesApi.updateConversation(spaceId, conversation.id, name)
        : await spacesApi.createConversation(spaceId, name, {
            voice: kind === "voice",
            categoryId: known || null,
          });
      if (conversation && known !== (conversation.category_id ?? "")) {
        const target = channelsIn(channelLayout(conversations, categories), known).filter(
          (item) => item.id !== conversation.id,
        );
        saved = await spacesApi.placeConversation(
          spaceId,
          conversation.id,
          known || null,
          target.at(-1)?.id ?? null,
        );
      }
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
          <Text
            bare
            as="label"
            size="meta"
            tone="muted"
            weight="medium"
            className="mt-5 grid gap-2"
          >
            Name
            <Input
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Text>
          {categories.length ? (
            <Text
              bare
              as="label"
              size="meta"
              tone="muted"
              weight="medium"
              className="mt-5 grid gap-2"
            >
              Category
              <OptionSelect
                value={categories.some((item) => item.id === category) ? category : ""}
                onValueChange={setCategory}
                options={[
                  { value: "", label: "No category" },
                  ...categories.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
            </Text>
          ) : null}
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
