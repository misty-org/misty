import { useEffect, useState } from "react";
import {
  codingAllowance,
  codingToolStatusText,
  codingTools,
  detectCodingTools,
  type CodingAllowance,
  type CodingToolStatus,
} from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../profiles/registry";
import { useSettingsProfiles } from "../profiles/store";
import { DropdownControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";
import { NativeAvailability } from "./FeatureSections";

function useDeviceSetting(id: string) {
  const d = definitionById.get(id)!;
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  return {
    label: d.label,
    value: String(fromLegacy(d, section?.[d.key]) || "none"),
    disabled: store.working || !ready,
    set: (next: string) => void store.updateSetting(d.section, d.key, next),
  };
}

const toolOptions = (none: string) => [
  { value: "none", label: none },
  ...codingTools.map((tool) => ({ value: tool.id, label: tool.name })),
];

function allowanceText(allowance: CodingAllowance) {
  const left = Math.max(0, allowance.allowanceTokens - allowance.usedTokens);
  const percent = allowance.allowanceTokens
    ? Math.round((left / allowance.allowanceTokens) * 100)
    : 0;
  const reset = allowance.resetsAt
    ? ` Resets ${new Date(allowance.resetsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`
    : "";
  return `${percent}% of this week’s coding allowance is left.${reset}`;
}

/**
 * Settings › Agents › Coding tools: the coding tools on this computer, which one
 * Misty agents hand coding to, and how much of each tool's own limit they may
 * use. These choices stay on this device. The allowance is the account's.
 */
export function CodingToolsSection() {
  const [statuses, setStatuses] = useState<CodingToolStatus[] | null>(null);
  const [allowance, setAllowance] = useState<CodingAllowance | null>(null);
  const [error, setError] = useState("");
  const native = hasTauriInternals();
  const defaultTool = useDeviceSetting("agents.coding_default_tool");
  const fallback = useDeviceSetting("agents.coding_fallback_tool");
  const cap = useDeviceSetting("agents.coding_usage_cap");
  useEffect(() => {
    if (!native) return;
    detectCodingTools()
      .then(setStatuses)
      .catch(() => setError("Misty couldn’t check the coding tools on this computer."));
    codingAllowance()
      .then(setAllowance)
      .catch(() => setError("Misty couldn’t load your coding allowance. Try again later."));
  }, [native]);
  if (!native) return <NativeAvailability feature="Coding tools" />;
  const installed = codingTools.filter((tool) =>
    statuses?.some((status) => status.engine === tool.id && status.installed),
  );
  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      {allowance && !allowance.available ? (
        <DesktopSettingsNotice>
          Coding through your own tools is part of paid Misty plans. Upgrade to let your agents hand
          coding to them.
        </DesktopSettingsNotice>
      ) : null}
      <Section
        title="Coding tools"
        description="Misty agents hand coding to the coding tools on this computer. Misty never installs a tool or signs in for you."
      >
        {statuses === null ? (
          <SkeletonList label="Coding tools" rows={3} leading="none" />
        ) : installed.length ? (
          installed.map((tool) => (
            <Row
              key={tool.id}
              label={tool.name}
              description={codingToolStatusText(
                tool,
                statuses.find((status) => status.engine === tool.id),
              )}
            >
              {null}
            </Row>
          ))
        ) : (
          <Row
            label="No coding tools found"
            description="Install Claude Code or Codex and sign in to it in a terminal, then reopen this page."
          >
            {null}
          </Row>
        )}
      </Section>
      <Section title="Routing">
        <Row
          label={defaultTool.label}
          description="Agents hand coding to this tool first. Only on this computer."
        >
          <DropdownControl
            value={defaultTool.value}
            disabled={defaultTool.disabled}
            options={toolOptions("None")}
            onValueChange={defaultTool.set}
          />
        </Row>
        <Row
          label={fallback.label}
          description="Used when the default is missing, signed out, at its limit or can’t work in the chat’s mode."
        >
          <DropdownControl
            value={fallback.value}
            disabled={fallback.disabled}
            options={toolOptions("No fallback")}
            onValueChange={fallback.set}
          />
        </Row>
        <Row
          label={cap.label}
          description="Agents stop using a tool once it has used this much of its own weekly limit. Only tools that report usage can be capped."
        >
          <DropdownControl
            value={cap.value}
            disabled={cap.disabled}
            options={[
              { value: "none", label: "No limit" },
              ...["25", "35", "50", "75"].map((value) => ({
                value,
                label: `${value}% of each tool’s weekly limit`,
              })),
            ]}
            onValueChange={cap.set}
          />
        </Row>
      </Section>
      <Section title="Allowance">
        {allowance === null && !error ? (
          <SkeletonList label="Coding allowance" rows={1} leading="none" lines={1} />
        ) : (
          <Row
            label="This week"
            description={
              allowance?.available
                ? `${allowanceText(allowance)} Coding counts toward your weekly AI allowance at a reduced rate.`
                : "Not included in your plan."
            }
          >
            {null}
          </Row>
        )}
      </Section>
    </>
  );
}
