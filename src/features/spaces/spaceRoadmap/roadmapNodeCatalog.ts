import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileText,
  Flag,
  Gauge,
  Goal,
  Link2,
  ListTodo,
  NotebookPen,
  Scale,
  Shapes,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  SpaceRoadmapEdgeEndpoint,
  SpaceRoadmapEdgeType,
  SpaceRoadmapFieldDefinition,
  SpaceRoadmapNodeColor,
  SpaceRoadmapNodeDefinition,
  SpaceRoadmapNodeKind,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";

export type RoadmapPaletteItem = {
  id: string;
  label: string;
  description: string;
  category: "Structure" | "Planning" | "Context" | "Custom";
  kind: "milestone" | "goal" | SpaceRoadmapNodeKind;
  icon: LucideIcon;
  color: SpaceRoadmapNodeColor;
  definition?: SpaceRoadmapNodeDefinition;
  fields?: SpaceRoadmapFieldDefinition[];
};

export const builtInRoadmapPalette: RoadmapPaletteItem[] = [
  {
    id: "milestone",
    label: "Milestone",
    description: "Group goals and supporting work.",
    category: "Structure",
    kind: "milestone",
    icon: Flag,
    color: "slate",
  },
  {
    id: "goal",
    label: "Goal",
    description: "Track an outcome through linked tasks.",
    category: "Structure",
    kind: "goal",
    icon: Goal,
    color: "blue",
  },
  {
    id: "risk",
    label: "Risk",
    description: "Track uncertainty and mitigation.",
    category: "Planning",
    kind: "risk",
    icon: AlertTriangle,
    color: "rose",
    fields: [
      {
        id: "severity",
        label: "Severity",
        type: "select",
        options: ["Low", "Medium", "High", "Critical"],
      },
      {
        id: "state",
        label: "State",
        type: "select",
        options: ["Open", "Mitigating", "Accepted", "Resolved"],
      },
      { id: "mitigation", label: "Mitigation", type: "long_text" },
    ],
  },
  {
    id: "decision",
    label: "Decision",
    description: "Capture a choice and its rationale.",
    category: "Planning",
    kind: "decision",
    icon: Scale,
    color: "violet",
    fields: [
      { id: "state", label: "State", type: "select", options: ["Proposed", "Decided", "Revisit"] },
      { id: "outcome", label: "Outcome", type: "long_text" },
      { id: "rationale", label: "Rationale", type: "long_text" },
    ],
  },
  {
    id: "metric",
    label: "Metric",
    description: "Measure progress toward an outcome.",
    category: "Planning",
    kind: "metric",
    icon: Gauge,
    color: "emerald",
    fields: [
      { id: "current", label: "Current", type: "number" },
      { id: "target", label: "Target", type: "number" },
      { id: "unit", label: "Unit", type: "short_text" },
      {
        id: "direction",
        label: "Direction",
        type: "select",
        options: ["Increase", "Decrease", "Maintain"],
      },
    ],
  },
  {
    id: "note",
    label: "Note / link",
    description: "Attach context without affecting progress.",
    category: "Context",
    kind: "note",
    icon: NotebookPen,
    color: "amber",
    fields: [{ id: "url", label: "URL", type: "url" }],
  },
];

export function roadmapPalette(definitions: SpaceRoadmapNodeDefinition[]) {
  return [
    ...builtInRoadmapPalette,
    ...definitions
      .filter((definition) => !definition.archived_at)
      .map<RoadmapPaletteItem>((definition) => ({
        id: `custom:${definition.id}`,
        label: definition.name,
        description: definition.description || "Custom Space node",
        category: "Custom",
        kind: "custom",
        icon: roadmapIcon(definition.icon),
        color: definition.color,
        definition,
        fields: definition.field_schema,
      })),
  ];
}

export const roadmapIconChoices = [
  { id: "shapes", label: "Shapes", icon: Shapes },
  { id: "sparkles", label: "Sparkles", icon: Sparkles },
  { id: "file-text", label: "Document", icon: FileText },
  { id: "link", label: "Link", icon: Link2 },
  { id: "check", label: "Check", icon: CheckCircle2 },
  { id: "question", label: "Question", icon: CircleHelp },
  { id: "tasks", label: "Tasks", icon: ListTodo },
];

export function roadmapIcon(id: string): LucideIcon {
  return roadmapIconChoices.find((choice) => choice.id === id)?.icon ?? Shapes;
}

export const roadmapNodeColors: Record<
  SpaceRoadmapNodeColor,
  { accent: string; soft: string; hex: string }
> = {
  slate: { accent: "border-l-slate-400 text-slate-300", soft: "bg-slate-500/10", hex: "#94a3b8" },
  blue: { accent: "border-l-blue-400 text-blue-300", soft: "bg-blue-500/10", hex: "#60a5fa" },
  cyan: { accent: "border-l-cyan-400 text-cyan-300", soft: "bg-cyan-500/10", hex: "#22d3ee" },
  emerald: {
    accent: "border-l-emerald-400 text-emerald-300",
    soft: "bg-emerald-500/10",
    hex: "#34d399",
  },
  amber: { accent: "border-l-amber-400 text-amber-300", soft: "bg-amber-500/10", hex: "#fbbf24" },
  orange: {
    accent: "border-l-orange-400 text-orange-300",
    soft: "bg-orange-500/10",
    hex: "#fb923c",
  },
  rose: { accent: "border-l-rose-400 text-rose-300", soft: "bg-rose-500/10", hex: "#fb7185" },
  violet: {
    accent: "border-l-violet-400 text-violet-300",
    soft: "bg-violet-500/10",
    hex: "#a78bfa",
  },
};

export const roadmapEdgeLabels: Record<SpaceRoadmapEdgeType, string> = {
  depends_on: "Depends on",
  blocks: "Blocks",
  enables: "Enables",
  contributes_to: "Contributes to",
  measures: "Measures",
  documents: "Documents",
  related: "Related",
};

export function allowedRoadmapEdgeTypes(
  source: SpaceRoadmapEdgeEndpoint,
  target: SpaceRoadmapEdgeEndpoint,
  sourceNodeKind?: SpaceRoadmapNodeKind,
): SpaceRoadmapEdgeType[] {
  const result: SpaceRoadmapEdgeType[] = ["related"];
  if (source.kind === "goal" && target.kind === "goal")
    result.unshift("depends_on", "blocks", "enables");
  if (
    (source.kind === "goal" || sourceNodeKind === "risk") &&
    (target.kind === "goal" || target.kind === "milestone")
  )
    result.unshift("blocks");
  if (
    (source.kind === "goal" || sourceNodeKind === "decision") &&
    (target.kind === "goal" || target.kind === "milestone")
  )
    result.unshift("enables");
  if (source.kind === "node" && (target.kind === "goal" || target.kind === "milestone"))
    result.unshift("contributes_to");
  if (sourceNodeKind === "metric" && (target.kind === "goal" || target.kind === "milestone"))
    result.unshift("measures");
  if (sourceNodeKind === "note") result.unshift("documents");
  return [...new Set(result)];
}
