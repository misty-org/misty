import type { LibraryAssetStack } from "@/api/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { Play } from "lucide-react";

const trayClass =
  "absolute left-4 flex items-center gap-1 rounded-xl border border-charcoal-border/10 bg-charcoal-workspace p-1 text-cream-bright ";

const liveEffects = ["still", "loop", "bounce", "long_exposure"] as const;

function chipClass(active: boolean) {
  return `rounded-lg border-0 px-2 py-1 text-[10px] font-medium ${
    active
      ? "bg-charcoal-active text-charcoal-bg"
      : "bg-transparent text-cream-bright/75 hover:bg-charcoal-active"
  }`;
}

/** Member picker for a stacked asset — Still/Motion, RAW/Rendered, or an index. */
export function LibraryStackChips({
  stack,
  activeItemID,
  primaryItemID,
  onSelect,
}: {
  stack: LibraryAssetStack;
  activeItemID: string;
  primaryItemID: string;
  onSelect: (itemId: string) => void;
}) {
  return (
    <div className={`${trayClass} top-4`}>
      {stack.members.map((member, memberIndex) => (
        <Button
          className={chipClass(member.item_id === activeItemID)}
          type="button"
          key={member.item_id}
          onClick={() => onSelect(member.item_id === primaryItemID ? "" : member.item_id)}
        >
          {stackMemberLabel(stack, member.role, memberIndex)}
        </Button>
      ))}
    </div>
  );
}

export function LibraryStackEffectChips({
  stack,
  onSelect,
}: {
  stack: LibraryAssetStack;
  onSelect: (effect: LibraryAssetStack["effect"]) => void;
}) {
  return (
    <div className={`${trayClass} top-16`}>
      {liveEffects.map((effect) => (
        <Button
          className={chipClass(stack.effect === effect)}
          type="button"
          key={effect}
          onClick={() => onSelect(effect)}
        >
          {effect === "long_exposure" ? "Long Exposure" : effect[0].toUpperCase() + effect.slice(1)}
        </Button>
      ))}
    </div>
  );
}

function stackMemberLabel(stack: LibraryAssetStack, role: string, memberIndex: number) {
  if (stack.kind === "live_photo") {
    return role === "motion" ? (
      <>
        <Play className="mr-1 inline" size={10} />
        Motion
      </>
    ) : (
      "Still"
    );
  }
  if (stack.kind === "raw_pair") return role === "raw" ? "RAW" : "Rendered";
  return memberIndex + 1;
}
