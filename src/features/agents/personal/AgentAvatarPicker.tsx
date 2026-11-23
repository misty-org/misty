import { useState } from "react";
import { Pencil } from "lucide-react";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import {
  Button,
  ChoiceTile,
  Field,
  Input,
  Pressable,
  RowGroupSection,
  RowGroupStack,
  Text,
} from "@misty/ui";
import { AgentAvatar, AgentCloudImage } from "./AgentAvatar";
import { agentCloudAvatar, agentCloudVariants } from "./agent_cloud_avatars";

export function AgentAvatarPicker({
  profile,
  name,
  avatar,
  busy,
  onChange,
}: {
  profile?: AgentProfile;
  name: string;
  avatar: AgentProfileInput["avatar"];
  busy: boolean;
  onChange(avatar: AgentProfileInput["avatar"]): void;
}) {
  const [avatarEditing, setAvatarEditing] = useState(false);
  return (
    <>
      <div className="flex items-center gap-4">
        <Pressable
          aria-label="Edit agent avatar"
          onClick={() => setAvatarEditing(!avatarEditing)}
          className="group relative size-16 shrink-0 overflow-hidden rounded-md"
        >
          <AgentAvatar
            agent={
              {
                ...profile,
                name: name || "Agent",
                avatar,
              } as AgentProfile
            }
            className="size-16"
          />
          <Text
            bare
            as="div"
            tone="bright"
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl"
          >
            <Pencil />
          </Text>
        </Pressable>
        <div className="flex-1 min-w-0">
          <Button
            variant="quiet"
            type="button"
            size="sm"
            onClick={() => setAvatarEditing(!avatarEditing)}
          >
            {avatarEditing ? "Hide avatar options" : "Change avatar"}
          </Button>
        </div>
      </div>
      {avatarEditing && (
        <RowGroupStack>
          <RowGroupSection title="Cloud avatar">
            <div className="grid grid-cols-2 gap-0.5">
              {agentCloudVariants.map((variant) => {
                const chosen =
                  !avatar?.emoji &&
                  agentCloudAvatar({
                    id: profile?.id ?? "",
                    name,
                    avatar,
                    system_managed: profile?.system_managed ?? false,
                  }).id === variant.id;
                return (
                  <ChoiceTile
                    key={variant.id}
                    label={`${variant.name}, ${variant.expression}`}
                    caption={variant.expression}
                    selected={chosen}
                    disabled={busy}
                    onSelect={() =>
                      onChange({
                        ...avatar,
                        emoji: "",
                        cloudVariant: variant.id,
                      })
                    }
                  >
                    <div className="flex size-14 shrink-0 items-center justify-center">
                      <AgentCloudImage variant={variant} fill />
                    </div>
                    <Text size="control">{variant.name}</Text>
                  </ChoiceTile>
                );
              })}
            </div>
          </RowGroupSection>
          <Field label="Custom emoji">
            <Input
              className="w-24"
              maxLength={12}
              value={typeof avatar?.emoji === "string" ? avatar.emoji : ""}
              placeholder="Optional"
              disabled={busy}
              onChange={(e) =>
                onChange({
                  ...avatar,
                  emoji: e.target.value,
                })
              }
            />
          </Field>
        </RowGroupStack>
      )}
    </>
  );
}
