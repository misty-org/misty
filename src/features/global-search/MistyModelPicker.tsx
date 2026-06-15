import { runtimeAssistantApi as assistantApi } from "@/features/agents/agentsRuntime";
import { type FrontierModel, type FrontierModelCatalog } from "@/api/assistant/api";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Check, ChevronDown, Cpu, Gauge } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ReasoningEffort = "" | "low" | "medium" | "high";
type CatalogEffort = FrontierModel["reasoning_levels"][number];

const effortLabels: Record<CatalogEffort, string> = {
  default: "Auto",
  low: "Light",
  medium: "Medium",
  high: "High",
};

const effortDescriptions: Record<CatalogEffort, string> = {
  default: "Misty chooses the right amount of reasoning.",
  low: "Fast responses for straightforward requests.",
  medium: "A balance of speed and careful reasoning.",
  high: "More careful reasoning for complex work.",
};

export function MistyModelPicker(props: {
  conversationId?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  disabled?: boolean;
  onChange: (settings: { modelId: string; reasoningEffort: ReasoningEffort }) => void;
}) {
  const [catalog, setCatalog] = useState<FrontierModelCatalog>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void assistantApi
      .frontierModels()
      .then((value) => active && setCatalog(value))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const modelId = props.modelId || catalog?.default_model_id || "";
  const selected = catalog?.models.find((model) => model.id === modelId);
  const selectedEffort = (props.reasoningEffort || "default") as CatalogEffort;

  const providers = useMemo(
    () =>
      Array.from(new Set(catalog?.models.map((model) => model.provider_id) ?? [])).map((id) => ({
        id,
        name: catalog?.models.find((model) => model.provider_id === id)?.provider_name ?? id,
        models: catalog?.models.filter((model) => model.provider_id === id) ?? [],
      })),
    [catalog],
  );

  const choose = async (model: FrontierModel, effort: CatalogEffort) => {
    if (!props.conversationId || saving) return;
    const reasoningEffort = (effort === "default" ? "" : effort) as ReasoningEffort;
    setSaving(true);
    try {
      await assistantApi.updateConversationSettings(props.conversationId, {
        model_id: model.id,
        reasoning_effort: reasoningEffort,
      });
      props.onChange({ modelId: model.id, reasoningEffort });
    } finally {
      setSaving(false);
    }
  };

  const chooseModel = (model: FrontierModel) => {
    const nextEffort = model.reasoning_levels.includes(selectedEffort)
      ? selectedEffort
      : model.reasoning_levels[0] || "default";
    return choose(model, nextEffort);
  };

  const effortLabel = effortLabels[selectedEffort] ?? "Auto";
  const triggerLabel = selected
    ? `${selected.name}${selectedEffort === "default" ? "" : ` ${effortLabel}`}`
    : "Choose model";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled || saving || !props.conversationId || !catalog?.models.length}
          className="h-8 max-w-56 gap-1.5 rounded-lg px-2.5 text-[11px] text-cream-muted hover:bg-charcoal-hover hover:text-cream"
          aria-label={`Model settings: ${triggerLabel}`}
        >
          <Cpu className="size-3.5" />
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-3 text-cream-muted" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-72 rounded-2xl border border-charcoal-border/80 bg-charcoal-card/98 p-2 shadow-2xl"
        data-misty-layer-portal
      >
        <DropdownMenuLabel className="px-2.5 pb-2 pt-1 text-xs font-semibold text-cream-muted">
          Model settings
        </DropdownMenuLabel>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-12 rounded-xl px-2.5 py-2.5">
            <Cpu className="size-4 text-cream-muted" />
            <span className="font-medium text-cream">Model</span>
            <span className="ml-auto max-w-32 truncate text-xs text-cream-muted">
              {selected?.name ?? "Choose"}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            sideOffset={8}
            className={cn(
              "max-h-[min(420px,calc(100dvh-2rem))] w-72 overflow-y-auto rounded-2xl",
              "border border-charcoal-border/80 bg-charcoal-card/98 p-2 shadow-2xl",
            )}
            data-misty-layer-portal
          >
            <DropdownMenuLabel className="px-2.5 pb-2 pt-1 text-xs font-semibold text-cream-muted">
              Model
            </DropdownMenuLabel>
            {providers.map((provider, index) => (
              <div key={provider.id}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="px-2.5 text-[10px] font-semibold text-cream-muted/80">
                  {provider.name}
                </DropdownMenuLabel>
                {provider.models.map((model) => {
                  const isSelected = model.id === modelId;
                  return (
                    <DropdownMenuItem
                      key={model.id}
                      disabled={saving}
                      onSelect={() => void chooseModel(model)}
                      className="min-h-10 rounded-lg px-2.5 py-2 text-xs"
                    >
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-md border border-charcoal-border/70 bg-charcoal-hover text-[10px] font-semibold",
                          isSelected ? "text-cream" : "text-cream-muted",
                        )}
                      >
                        {provider.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          isSelected ? "font-medium text-cream" : "text-cream-muted",
                        )}
                      >
                        {model.name}
                      </span>
                      {isSelected ? <Check className="size-4 text-cream" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={!selected || !selected.reasoning_levels.length}
            className="min-h-12 rounded-xl px-2.5 py-2.5"
          >
            <Gauge className="size-4 text-cream-muted" />
            <span className="font-medium text-cream">Effort</span>
            <span className="ml-auto text-xs text-cream-muted">{effortLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            sideOffset={8}
            className="w-72 rounded-2xl border border-charcoal-border/80 bg-charcoal-card/98 p-2 shadow-2xl"
            data-misty-layer-portal
          >
            <DropdownMenuLabel className="px-2.5 pb-2 pt-1 text-xs font-semibold text-cream-muted">
              Effort
            </DropdownMenuLabel>
            {selected?.reasoning_levels.map((effort) => {
              const active = effort === selectedEffort;
              return (
                <DropdownMenuItem
                  key={effort}
                  disabled={saving}
                  onSelect={() => void choose(selected, effort)}
                  className="items-start rounded-lg px-2.5 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", active && "font-medium text-cream")}>
                      {effortLabels[effort]}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-cream-muted">
                      {effortDescriptions[effort]}
                    </span>
                  </span>
                  {active ? <Check className="mt-0.5 size-4 text-cream" /> : null}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <p className="px-2.5 py-1.5 text-[11px] leading-4 text-cream-muted">
              Higher effort may take longer and use more of your plan.
            </p>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
