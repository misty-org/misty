import { useEffect, useMemo, useState } from "react";
import { Bot, CalendarDays, Code2, PenLine, Search, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/ui";
import type { AgentAvatar as AgentAvatarValue } from "@/models/interfaces/features/agents/personal";
import { resolveSpacesApiBase } from "@/stores/spaces/useSpacesBackendStore";
import {
  readAccountAuthToken,
  readAccountSessionGeneration,
} from "@/stores/account/useAuthTokenStore";

const presetIcons: Record<string, LucideIcon> = {
  bot: Bot,
  sparkles: Sparkles,
  researcher: Search,
  writer: PenLine,
  planner: CalendarDays,
  builder: Code2,
};

const accentClasses: Record<string, string> = {
  indigo: "bg-agent-indigo text-avatar-ink",
  violet: "bg-agent-violet text-avatar-ink",
  blue: "bg-agent-blue text-avatar-ink",
  emerald: "bg-agent-emerald text-avatar-ink",
  amber: "bg-agent-amber text-avatar-ink",
  rose: "bg-agent-rose text-avatar-ink",
  neutral: "border border-charcoal-border bg-charcoal-card text-cream-bright",
};

export const agentAvatarPresets = [
  { id: "bot", label: "Generalist", icon: Bot },
  { id: "researcher", label: "Researcher", icon: Search },
  { id: "writer", label: "Writer", icon: PenLine },
  { id: "planner", label: "Planner", icon: CalendarDays },
  { id: "builder", label: "Builder", icon: Code2 },
  { id: "sparkles", label: "Coordinator", icon: Sparkles },
] as const;

export const agentAvatarAccents = ["indigo", "violet", "blue", "emerald", "amber", "rose"];

export function AgentAvatar({
  agentId,
  avatar,
  legacyIcon,
  name,
  className,
  iconClassName,
}: {
  agentId?: string;
  avatar?: AgentAvatarValue;
  legacyIcon?: string;
  name: string;
  className?: string;
  iconClassName?: string;
}) {
  const resolved = avatar ?? {
    kind: "preset" as const,
    preset_id: legacyIcon || "bot",
    accent: "indigo",
  };
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setImageUrl(null);
    if (resolved.kind !== "upload" || !agentId) return;
    const generation = readAccountSessionGeneration();
    void Promise.all([resolveSpacesApiBase(), readAccountAuthToken()])
      .then(async ([base, token]) => {
        const headers = new Headers();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        const response = await fetch(
          `${base}/agents/${encodeURIComponent(agentId)}/avatar?version=${resolved.version}`,
          { credentials: "include", headers },
        );
        if (!response.ok || generation !== readAccountSessionGeneration()) return;
        const blob = await response.blob();
        if (!current || generation !== readAccountSessionGeneration()) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [agentId, resolved.kind, resolved.kind === "upload" ? resolved.version : undefined]);

  const PresetIcon = useMemo(
    () =>
      resolved.kind === "preset"
        ? (presetIcons[resolved.preset_id] ?? presetIcons[legacyIcon || ""] ?? Bot)
        : Bot,
    [legacyIcon, resolved],
  );
  const accent = resolved.kind === "preset" ? resolved.accent : "neutral";

  return (
    <span
      className={cn(
        "relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full",
        accentClasses[accent] ?? accentClasses.indigo,
        className,
      )}
      aria-label={`${name} avatar`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <PresetIcon className={cn("size-4", iconClassName)} aria-hidden="true" />
      )}
    </span>
  );
}
