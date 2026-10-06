import { Code } from "lucide-react";
import { useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  MenuTrigger,
} from "@/shared/ui";
import { CodingToolIcon } from "../coding/CodingToolIcon";
import { CodingUpgradeNote } from "../coding/CodingUpgradeNote";
import { codingTools, detectCodingTools, type CodingToolStatus } from "../coding/codingTools";
import { useCodingIncluded } from "../coding/useCodingIncluded";
import { useConversationCodingTool } from "../store/useConversationCodingTool";

const settingsDefault = "default";

/** Why a tool can't be picked on this computer, in a word or two; empty when it can. */
function unavailable(status?: CodingToolStatus) {
  if (!status) return "";
  if (!status.installed) return "Not installed";
  return status.signed_in ? "" : "Signed out";
}

/**
 * The composer's coding tool for this conversation: the Settings default, or one of the
 * person's own coding tools. Tools that aren't installed or signed in on this computer are
 * listed but can't be picked. The choice is the conversation's, with or without a project.
 * Plans without coding see an upgrade note instead. Desktop only.
 */
export function AgentCodingToolMenu({
  conversationId,
  disabled,
}: {
  conversationId?: string;
  disabled?: boolean;
}) {
  const [statuses, setStatuses] = useState<CodingToolStatus[]>([]);
  const chosen = useConversationCodingTool((s) => s.tool(conversationId));
  const setTool = useConversationCodingTool((s) => s.setTool);
  const load = () => {
    detectCodingTools()
      .then(setStatuses)
      .catch(() => undefined);
  };
  const included = useCodingIncluded(hasTauriInternals());
  useEffect(() => {
    if (hasTauriInternals()) load();
  }, []);
  if (!hasTauriInternals()) return null;
  if (included === false)
    return (
      <DropdownMenu>
        <MenuTrigger
          label="Code"
          title="Coding is part of Misty Pro and above"
          icon={<Code aria-hidden className="size-4 shrink-0" />}
          chevron={false}
          disabled={disabled}
          className="agent-strip-chip"
        />
        <DropdownMenuContent align="start" className="w-64" data-misty-layer-portal>
          <DropdownMenuLabel>Code</DropdownMenuLabel>
          <CodingUpgradeNote />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  const current = codingTools.find((tool) => tool.id === chosen);
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <MenuTrigger
        label="Code"
        title={current ? `Code with ${current.name}` : "Code with the Settings default"}
        icon={
          current ? (
            <CodingToolIcon tool={current.id} />
          ) : (
            <Code aria-hidden className="size-4 shrink-0" />
          )
        }
        chevron={false}
        disabled={disabled}
        className="agent-strip-chip"
      />
      <DropdownMenuContent align="start" className="w-64" data-misty-layer-portal>
        <DropdownMenuLabel>Code</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current?.id ?? settingsDefault}
          onValueChange={(next) => setTool(conversationId, next === settingsDefault ? null : next)}
        >
          <DropdownMenuRadioItem value={settingsDefault}>Settings default</DropdownMenuRadioItem>
          {codingTools.map((tool) => {
            const status = statuses.find((s) => s.engine === tool.id);
            const reason = unavailable(status);
            return (
              <DropdownMenuRadioItem
                key={tool.id}
                value={tool.id}
                disabled={Boolean(reason) || !status}
              >
                <CodingToolIcon tool={tool.id} />
                <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                {reason && <span className="text-xs text-cream-muted">{reason}</span>}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            window.dispatchEvent(
              new CustomEvent("misty:open-settings", { detail: { section: "agents-coding" } }),
            )
          }
        >
          Manage tools
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
