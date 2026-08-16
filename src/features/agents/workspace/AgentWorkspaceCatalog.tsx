import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Code,
  FileText,
  Globe,
  Mail,
  Repeat2,
} from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { AgentMethodsCatalog } from "./AgentMethodsCatalog";
import { ConnectedAppsCatalog } from "../apps/ConnectedAppsCatalog";
type Template = { name: string; category: string; apps: string[]; schedule?: string };
const taskTemplates: Template[] = [
  {
    name: "Draft replies to messages waiting on me",
    category: "Ops",
    apps: ["Mail"],
    schedule: "Weekdays at 5pm",
  },
  {
    name: "A morning brief from my calendar and inbox",
    category: "Ops",
    apps: ["Calendar", "Mail"],
    schedule: "Every day at 7am",
  },
  {
    name: "Organize my inbox for the day ahead",
    category: "Ops",
    apps: ["Mail"],
    schedule: "Daily at 7am",
  },
  { name: "Research a topic and build a useful report", category: "Research", apps: ["Journal"] },
  { name: "Turn a listing page into a spreadsheet", category: "Data", apps: ["Files"] },
  {
    name: "Build a prospect list from a company directory",
    category: "Sales",
    apps: ["Browser", "Files"],
  },
  { name: "Compare my options and help me choose", category: "Research", apps: [] },
  {
    name: "Prepare a brief before my next meeting",
    category: "Research",
    apps: ["Calendar", "Journal"],
  },
  {
    name: "Find new roles that match my experience",
    category: "Career",
    apps: ["Browser"],
    schedule: "Weekdays at 9am",
  },
  { name: "Find the best price for an item", category: "Personal", apps: [] },
  { name: "Check a webpage and suggest improvements", category: "Engineering", apps: [] },
  {
    name: "Summarize the updates that matter to me",
    category: "Marketing",
    apps: ["Browser"],
    schedule: "Weekdays at 8am",
  },
  {
    name: "Follow up on messages with no reply",
    category: "Ops",
    apps: ["Mail"],
    schedule: "Weekdays at 8am",
  },
  { name: "Pull decisions out of my meeting notes", category: "Docs", apps: ["Journal"] },
  {
    name: "Check service status before the workday",
    category: "Monitoring",
    apps: ["Browser"],
    schedule: "Every day at 8am",
  },
  {
    name: "Build an interview plan from the role brief",
    category: "Recruiting",
    apps: ["Journal"],
  },
];
const examples: Template[] = [
  {
    name: "Brief me each morning on the topics I follow",
    category: "Research",
    apps: [],
    schedule: "Daily at 7am",
  },
  {
    name: "Track new releases for my dependencies",
    category: "Engineering",
    apps: ["Code"],
    schedule: "Wednesdays at 9am",
  },
  {
    name: "Watch the status of the services I use",
    category: "Monitoring",
    apps: ["Browser"],
    schedule: "Every day at 8am",
  },
  {
    name: "Send me a weekly project health report",
    category: "Ops",
    apps: ["Code"],
    schedule: "Mondays at 9am",
  },
  {
    name: "Review my dashboards and flag changes",
    category: "Data",
    apps: ["Browser"],
    schedule: "Weekdays at 9am",
  },
  {
    name: "Check my core flows before standup",
    category: "Engineering",
    apps: [],
    schedule: "Weekdays at 8am",
  },
];
const categories = [
  "All",
  "Ops",
  "Research",
  "Sales",
  "Data",
  "Marketing",
  "Personal",
  "Career",
  "Docs",
  "Engineering",
  "Monitoring",
  "Recruiting",
];

const appIcon = (name: string) =>
  name === "Mail"
    ? Mail
    : name === "Calendar"
      ? CalendarClock
      : name === "Browser"
        ? Globe
        : name === "Code"
          ? Code
          : name === "Files"
            ? FileText
            : BookOpen;
export function AgentWorkspaceCatalog({
  page,
  onNavigate,
  onUse,
  agentId,
  onConversation,
  onStartWork,
}: {
  agentName: string;
  agentId: string;
  page: "workflows" | "templates" | "integrations";
  onNavigate(page: "new" | "templates" | "integrations"): void;
  onUse(prompt: string): void;
  onConversation(id: string): void;
  onStartWork(action: () => void): void;
}) {
  const [section, setSection] = useState("Tasks");
  const [integrationSection, setIntegrationSection] = useState("Apps");
  const [category, setCategory] = useState("All");
  const [detail, setDetail] = useState<Template | null>(null);
  const skills =
    page === "templates"
      ? section === "Skills"
      : page === "integrations" && integrationSection === "Skills";
  const prompt = (template: Template) =>
    `${template.name}. Start by clarifying what I need, use original sources, and prepare ` +
    "a concise result with links. Highlight anything uncertain and leave external changes " +
    "for my review.";
  return (
    <div className={`agent-studio-pages ${page}`}>
      {page !== "workflows" && (
        <aside className="agent-studio-subnav">
          <h1>{page === "templates" ? "Templates" : "Integrations"}</h1>
          <nav aria-label={page === "templates" ? "Template sections" : "Integration sections"}>
            {(page === "templates" ? ["Tasks", "Skills"] : ["Apps", "Skills"]).map((name) => (
              <Button
                key={name}
                variant="ghost"
                justify="start"
                aria-current={
                  (page === "templates" ? section : integrationSection) === name
                    ? "page"
                    : undefined
                }
                onClick={() =>
                  page === "templates" ? setSection(name) : setIntegrationSection(name)
                }
              >
                {name}
              </Button>
            ))}
          </nav>
        </aside>
      )}
      <div className="agent-studio-page-scroll">
        {page === "integrations" && !skills ? (
          <ConnectedAppsCatalog />
        ) : (
          <AgentMethodsCatalog
            key={`${agentId}:${page}:${skills}`}
            agentId={agentId}
            kind={skills ? "skill" : page === "workflows" ? "workflow" : "template"}
            onUse={onUse}
            onConversation={onConversation}
            onStartWork={onStartWork}
          >
            {!skills && (
              <section className="agent-method-examples">
                <h2>Start from an example</h2>
                {page === "templates" && (
                  <div className="agent-studio-category-strip">
                    {categories.map((name) => (
                      <Button
                        key={name}
                        variant="ghost"
                        size="sm"
                        aria-pressed={name === category}
                        onClick={() => setCategory(name)}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="agent-studio-grid">
                  {(page === "workflows" ? examples : taskTemplates)
                    .filter(
                      (t) => page === "workflows" || category === "All" || t.category === category,
                    )
                    .map((template) => (
                      <Card className="agent-studio-template-card" key={template.name}>
                        <Button variant="ghost" onClick={() => setDetail(template)}>
                          <span>{template.name}</span>
                          <div className="agent-studio-template-meta">
                            {template.apps.map((name) => {
                              const Icon = appIcon(name);
                              return <Icon key={name} size={16} aria-label={name} />;
                            })}
                            {template.schedule && (
                              <span className="agent-studio-schedule-tag">
                                <Repeat2 size={11} />
                                Suggested cadence
                              </span>
                            )}
                          </div>
                        </Button>
                      </Card>
                    ))}
                </div>
                {page === "workflows" && (
                  <Button variant="outline" onClick={() => onNavigate("templates")}>
                    <BookOpen size={15} />
                    Browse all examples
                  </Button>
                )}
              </section>
            )}
          </AgentMethodsCatalog>
        )}
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="agent-studio-dialog">
          <DialogTitle>{detail?.name}</DialogTitle>
          <DialogDescription>
            Example prompt. Review the draft and the agent’s available connections before starting
            work.
          </DialogDescription>
          <p>{detail ? prompt(detail) : ""}</p>
          <div className="agent-studio-detail-actions">
            <Button
              onClick={() => {
                if (detail) onUse(prompt(detail));
                setDetail(null);
              }}
            >
              Open draft
              <ArrowRight size={14} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
