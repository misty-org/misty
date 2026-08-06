import type { ReactNode } from "react";
import { Upload } from "lucide-react";
import { Button, Input, Label, Textarea, cn } from "@/ui";
import { AgentAvatar, agentAvatarAccents, agentAvatarPresets } from "./AgentAvatar";

const accentSwatches: Record<string, string> = {
  indigo: "bg-sage-bg",
  violet: "bg-sage-bg",
  blue: "bg-sage-bg",
  emerald: "bg-status-green",
  amber: "bg-sage-bg",
  rose: "bg-sage-bg",
};

export function AgentCreatorIdentityStep(props: {
  name: string;
  role: string;
  purpose: string;
  preset: string;
  accent: string;
  avatarFile: File | null;
  onNameChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onPurposeChange: (value: string) => void;
  onPresetChange: (value: string) => void;
  onAccentChange: (value: string) => void;
  onAvatarFileChange: (file: File | null) => void;
  onError: (message: string) => void;
}) {
  return (
    <>
      <IdentityField label="Name" hint="How teammates will address this Agent.">
        <Input
          value={props.name}
          maxLength={80}
          onChange={(event) => props.onNameChange(event.target.value)}
          autoFocus
        />
      </IdentityField>
      <IdentityField label="Professional role" hint="Visible in Team, tasks, and Agent profiles.">
        <Input
          value={props.role}
          maxLength={80}
          placeholder="Research assistant"
          onChange={(event) => props.onRoleChange(event.target.value)}
        />
      </IdentityField>
      <IdentityField label="Purpose" hint="A concise description of what this teammate owns.">
        <Textarea
          value={props.purpose}
          maxLength={400}
          rows={3}
          onChange={(event) => props.onPurposeChange(event.target.value)}
        />
      </IdentityField>
      <IdentityField
        label="Avatar"
        hint="Choose a curated identity or upload your own PNG, JPEG, or WebP."
      >
        <div className="flex flex-wrap gap-2">
          {agentAvatarPresets.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              className={cn(
                "grid h-auto w-[92px] justify-items-center gap-2 p-3 text-xs",
                !props.avatarFile &&
                  props.preset === item.id &&
                  "border-charcoal-active bg-charcoal-active",
              )}
              onClick={() => {
                props.onPresetChange(item.id);
                props.onAvatarFileChange(null);
              }}
            >
              <AgentAvatar
                name={item.label}
                avatar={{ kind: "preset", preset_id: item.id, accent: props.accent }}
              />
              {item.label}
            </Button>
          ))}
          <Label
            className={cn(
              "grid w-[92px] cursor-pointer justify-items-center gap-2 rounded-lg border p-3 text-xs hover:bg-charcoal-card",
              props.avatarFile && "border-charcoal-active bg-charcoal-active",
            )}
          >
            <span className="grid size-8 place-items-center rounded-full bg-charcoal-card">
              <Upload size={15} />
            </span>
            Upload
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && file.size > 5 * 1024 * 1024) {
                  props.onError("Avatar files must be 5 MB or smaller.");
                  return;
                }
                props.onAvatarFileChange(file);
                props.onError("");
              }}
            />
          </Label>
        </div>
        <div className="flex flex-wrap gap-2">
          {agentAvatarAccents.map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${value} accent`}
              className={cn(
                "size-6 rounded-full border-2 p-0",
                props.accent === value ? "border-cream" : "border-transparent",
                accentSwatches[value],
              )}
              onClick={() => props.onAccentChange(value)}
            />
          ))}
        </div>
      </IdentityField>
    </>
  );
}

function IdentityField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div>
        <Label className="font-medium">{label}</Label>
        {hint ? <p className="mb-0 mt-0.5 text-xs text-cream-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
