import { CircleAlert, Eye, FilePen, OctagonAlert, PencilLine } from "lucide-react";
import type { PlanRisk } from "./types";

/** Risk carries an icon and a word, never a color. */
const planRisks: Record<PlanRisk, { label: string; Icon: typeof Eye }> = {
  read: { label: "Reads", Icon: Eye },
  draft: { label: "Drafts", Icon: FilePen },
  write: { label: "Changes", Icon: PencilLine },
  consequential: { label: "Asks first", Icon: CircleAlert },
  dangerous: { label: "Risky", Icon: OctagonAlert },
};

export function PlanRiskTag({ risk }: { risk: PlanRisk }) {
  const { label, Icon } = planRisks[risk] ?? planRisks.read;
  return (
    <span className="agent-plan-risk" title={`Risk: ${label}`}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
