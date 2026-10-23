import { useState } from "react";
import { Pencil } from "lucide-react";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, Input, Pressable, Toggle } from "@/shared/ui";
import { AgentAvatar, AgentCloudImage } from "./AgentAvatar";
import { agentCloudAvatar, agentCloudVariants } from "./agentCloudAvatars";

/** The profile's avatar, and the cloud and emoji choices that open under it. */
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
      <div className="agent-profile-avatar-row">
        <Pressable
          aria-label="Edit agent avatar"
          onClick={() => setAvatarEditing(!avatarEditing)}
          className="agent-profile-avatar group relative shrink-0 overflow-hidden rounded-md"
        >
          <AgentAvatar
            agent={
              {
                ...profile,
                name: name || "Agent",
                avatar,
              } as AgentProfile
            }
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
            <Pencil className="size-3.5 text-cream-bright" />
          </div>
        </Pressable>
        <div className="flex-1 min-w-0">
          <Button
            variant="ghost"
            type="button"
            size="sm"
            className="h-auto p-0 text-sm"
            onClick={() => setAvatarEditing(!avatarEditing)}
          >
            {avatarEditing ? "Hide avatar options" : "Change avatar"}
          </Button>
        </div>
      </div>
      {avatarEditing && (
        <div className="rounded-xl border border-charcoal-border/70 bg-charcoal-bg/50 p-4 space-y-4">
          <div>
            <div className="text-xs font-medium text-cream-muted mb-2">Cloud avatar</div>
            <div className="grid grid-cols-2 gap-2">
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
                  <Toggle
                    key={variant.id}
                    variant="outline"
                    aria-label={`${variant.name}, ${variant.expression}`}
                    pressed={chosen}
                    disabled={busy}
                    onPressedChange={() =>
                      onChange({
                        ...avatar,
                        emoji: "",
                        cloudVariant: variant.id,
                      })
                    }
                    className="h-auto flex-col gap-1 whitespace-normal rounded-lg p-2.5 text-center text-cream-muted data-[state=on]:border-cream-bright/80"
                  >
                    <div className="size-14 shrink-0 flex items-center justify-center">
                      <AgentCloudImage variant={variant} />
                    </div>
                    <span className="text-xs font-medium text-cream leading-none">
                      {variant.name}
                    </span>
                    <span className="text-[13px] text-cream-muted leading-tight">
                      {variant.expression}
                    </span>
                  </Toggle>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2 border-t border-charcoal-border/60">
            <label
              htmlFor="agent-custom-emoji"
              className="text-xs font-medium text-cream-muted shrink-0"
            >
              Custom emoji
            </label>
            <Input
              id="agent-custom-emoji"
              className="w-24 text-center text-base"
              aria-label="Avatar emoji"
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
            <span className="text-xs text-cream-muted/70">Replaces cloud avatar when set</span>
          </div>
        </div>
      )}
    </>
  );
}
