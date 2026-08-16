import React, { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  Code,
  FileText,
  Folder,
  Globe,
  HelpCircle,
  Import,
  LayoutGrid,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Repeat2,
  Search,
  SlidersHorizontal,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/shared/ui/controls/Button";
import { IconButton } from "@/shared/ui/controls/IconButton";
import { Input } from "@/shared/ui/controls/Input";
import { Textarea } from "@/shared/ui/controls/Textarea";
import { OptionSelect } from "@/shared/ui/controls/OptionSelect";
import { Card } from "@/shared/ui/display/Card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/shared/ui/overlays/Dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/shared/ui/overlays/DropdownMenu";
import { DesktopSettingsSection } from "@/features/settings/components/DesktopSettingsUI";

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
const connectors = [
  {
    name: "Google",
    description: "Email, documents, spreadsheets, files, and calendar",
    category: "Top connectors",
    icon: Globe,
  },
  {
    name: "Messages",
    description: "Conversations and contacts, in one place",
    category: "Top connectors",
    icon: MessageSquare,
  },
  {
    name: "Slack",
    description: "Find messages, people, and team updates",
    category: "Top connectors",
    icon: MessageSquare,
  },
  {
    name: "Notion",
    description: "Search pages and organize your team’s knowledge",
    category: "Top connectors",
    icon: BookOpen,
  },
  {
    name: "HubSpot",
    description: "Find companies, contacts, and deal context",
    category: "Top connectors",
    icon: LayoutGrid,
  },
  {
    name: "Outlook",
    description: "Email, calendar, and meeting preparation",
    category: "Top connectors",
    icon: Mail,
  },
  {
    name: "Misty Journal",
    description: "Use your writing and notes as context",
    category: "Productivity",
    icon: BookOpen,
  },
  {
    name: "Misty Planner",
    description: "Plan tasks and review what is coming up",
    category: "Productivity",
    icon: CalendarClock,
  },
  {
    name: "Linear",
    description: "Read issues and understand project progress",
    category: "Productivity",
    icon: LayoutGrid,
  },
  {
    name: "Misty Library",
    description: "Find the files and references you already saved",
    category: "Productivity",
    icon: Folder,
  },
  {
    name: "Calendly",
    description: "Find meeting availability and scheduling links",
    category: "Productivity",
    icon: CalendarClock,
  },
  {
    name: "Asana",
    description: "Review team tasks, projects, and goals",
    category: "Productivity",
    icon: LayoutGrid,
  },
  {
    name: "GitHub",
    description: "Read repositories, pull requests, and issues",
    category: "Developer tools",
    icon: Code,
  },
  {
    name: "Browser",
    description: "Work with pages in a Misty browser window",
    category: "Developer tools",
    icon: Globe,
  },
];
const skillNames = ["Writing with sources", "Standup updates", "Review a draft"];
const appIcon = (s: string) =>
  s === "Mail"
    ? Mail
    : s === "Calendar"
      ? CalendarClock
      : s === "Browser"
        ? Globe
        : s === "Code"
          ? Code
          : s === "Files"
            ? FileText
            : BookOpen;
export function PolarPages({
  page,
  onNavigate,
  onUse,
}: {
  page: "workflows" | "templates" | "customize";
  onNavigate: (page: "new" | "templates" | "customize") => void;
  onUse: (prompt: string) => void;
}) {
  const [sub, setSub] = useState("Tasks");
  const [custom, setCustom] = useState("Connectors");
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [role, setRole] = useState("Everyone");
  const [detail, setDetail] = useState<Template | null>(null);
  const [workflow, setWorkflow] = useState(false);
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState<string | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState(false);
  const openWorkflow = (t?: Template) => {
    setDetail(null);
    setCommand(
      t
        ? t.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 30)
        : "",
    );
    setDescription(t?.name || "");
    setInstructions(
      t
        ? `${t.name}. Review the original sources, identify anything that needs my attention, and prepare a concise result for me to review.`
        : "",
    );
    setSchedule(!!t?.schedule);
    setWorkflow(true);
  };
  const promptFor = (t: Template) =>
    `${t.name}. Start by clarifying what I need, use original sources, and prepare a concise result with links. Highlight anything uncertain and leave external changes for my review.`;
  const templateCard = (t: Template) => (
    <Card className="polar-template-card" key={t.name}>
      <Button variant="ghost" onClick={() => setDetail(t)}>
        <span>{t.name}</span>
        <div className="template-meta">
          {t.apps.map((a) => {
            const Icon = appIcon(a);
            return <Icon key={a} size={16} aria-label={a} />;
          })}
          {t.schedule && (
            <span className="schedule-tag">
              <Repeat2 size={11} />
              {t.schedule}
            </span>
          )}
        </div>
      </Button>
    </Card>
  );
  const catalog = (items: Template[], heading: string) => (
    <section className="catalog-section">
      <header>
        <h2>{heading}</h2>
        {heading !== "Featured" && (
          <Button variant="ghost" size="sm" onClick={() => setCategory(heading)}>
            See all <ArrowRight size={12} />
          </Button>
        )}
      </header>
      <div className="polar-grid">{items.map(templateCard)}</div>
    </section>
  );
  const visible = taskTemplates.filter(
    (t) =>
      (category === "All" || t.category === category) &&
      (!scheduled || !!t.schedule) &&
      t.name.toLowerCase().includes(query.toLowerCase()),
  );
  const connectionItems = connectors.filter(
    (c) =>
      (category === "All" ||
        c.category === category ||
        (category === "Communication" && ["Slack", "Messages", "Outlook"].includes(c.name))) &&
      `${c.name} ${c.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={`polar-pages ${page}`}>
      {page !== "workflows" && (
        <aside className="polar-subnav">
          <h1>{page === "templates" ? "Templates" : "Customize"}</h1>
          <nav aria-label={page === "templates" ? "Template sections" : "Customize sections"}>
            {(page === "templates"
              ? ["Tasks", "Skills"]
              : ["Connectors", "Instructions", "Skills"]
            ).map((s) => (
              <Button
                key={s}
                variant="ghost"
                justify="start"
                className={(page === "templates" ? sub : custom) === s ? "selected" : ""}
                onClick={() => {
                  page === "templates" ? setSub(s) : setCustom(s);
                  setQuery("");
                  setCategory("All");
                  setEditingSkill(false);
                }}
              >
                {s}
              </Button>
            ))}
          </nav>
        </aside>
      )}
      <div className="polar-page-scroll">
        {page === "workflows" && (
          <div className="polar-workflows">
            <header className="polar-heading">
              <h1>Workflows</h1>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    New workflow <ChevronDown size={13} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onUse("Help me create a reusable workflow.")}>
                    Chat with Misty
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openWorkflow()}>
                    Set up manually
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            {saved.length ? (
              <div className="saved-workflows">
                {saved.map((s) => (
                  <button
                    key={s}
                    onClick={() => openWorkflow({ name: s, category: "Ops", apps: [] })}
                  >
                    <Workflow size={18} />
                    <span>
                      {s}
                      <small>On demand · Preview only</small>
                    </span>
                    <MoreHorizontal size={17} />
                  </button>
                ))}
              </div>
            ) : (
              <section className="workflow-empty">
                <Workflow size={30} />
                <h2>No workflows yet</h2>
                <p>
                  Save a task once and run it again—on a schedule,
                  <br />
                  or whenever you need it with <code>/command</code>.
                </p>
              </section>
            )}
            <section className="workflow-examples">
              <h2>Start from an example</h2>
              <div className="polar-grid">{examples.map(templateCard)}</div>
              <Button variant="outline" onClick={() => onNavigate("templates")}>
                <BookOpen size={15} />
                Browse all examples
              </Button>
            </section>
          </div>
        )}
        {page === "templates" && (
          <div className="polar-catalog">
            <header className="polar-heading">
              <div>
                <h1>{sub}</h1>
                <p>
                  {sub === "Tasks"
                    ? "Browse what Misty can do. Start with a task, or save it as a workflow to use again."
                    : "Reusable know-how that Misty can bring to your work."}
                </p>
              </div>
            </header>
            <div className="polar-search">
              <Search size={15} />
              <Input
                aria-label={`Search ${sub.toLowerCase()}`}
                placeholder={sub === "Tasks" ? "Search tasks, sites, roles…" : "Search skills…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {sub === "Tasks" ? (
              <>
                <div className="category-strip">
                  {categories.map((c) => (
                    <Button
                      key={c}
                      variant="ghost"
                      size="sm"
                      aria-pressed={category === c}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </Button>
                  ))}
                </div>
                <div className="catalog-filters">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        For {role}
                        <ChevronDown size={12} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {["Everyone", "Personal work", "Teams"].map((r) => (
                        <DropdownMenuItem key={r} onSelect={() => setRole(r)}>
                          <span className="choice-check">{role === r && <Check size={12} />}</span>
                          {r}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-pressed={scheduled}
                    onClick={() => setScheduled(!scheduled)}
                  >
                    <Repeat2 size={12} />
                    Scheduled
                  </Button>
                </div>
                {visible.length ? (
                  catalog(visible.slice(0, 12), category === "All" ? "Featured" : category)
                ) : (
                  <p className="catalog-empty">No templates match your search.</p>
                )}
                {category === "All" &&
                  !query &&
                  !scheduled &&
                  catalog(
                    taskTemplates.filter((t) => t.category === "Ops"),
                    "Ops",
                  )}
              </>
            ) : (
              catalog(
                skillNames
                  .filter((s) => s.toLowerCase().includes(query.toLowerCase()))
                  .map((name) => ({ name, category: "Skills", apps: ["Journal"] })),
                "Featured skills",
              )
            )}
          </div>
        )}
        {page === "customize" && custom === "Connectors" && (
          <div className="polar-connectors">
            <header className="polar-heading">
              <div>
                <h1>Connectors</h1>
                <p>Bring the apps you use into Misty’s tasks.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConnection("Custom connector")}>
                <Plus size={14} />
                Add custom
              </Button>
            </header>
            <div className="connector-browser">
              <h2>Browse connectors</h2>
              <div className="polar-search">
                <Search size={15} />
                <Input
                  aria-label="Search connectors"
                  placeholder={`Search ${connectors.length} example connectors…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="category-strip">
                {["All", "Productivity", "Communication", "Developer tools"].map((c) => (
                  <Button
                    key={c}
                    variant="ghost"
                    size="sm"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              {["Top connectors", "Productivity", "Developer tools"].map((group) => {
                const items = connectionItems.filter((c) => c.category === group);
                return (
                  items.length > 0 && (
                    <section className="connector-section" key={group}>
                      <header>
                        <h2>{group}</h2>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setNotice(`${items.length} example connectors shown.`)}
                        >
                          Show all
                        </Button>
                      </header>
                      <div className="polar-grid">
                        {items.map((c) => (
                          <Card className="connector-card" key={c.name}>
                            <Button
                              variant="ghost"
                              onClick={() => setConnection(c.name)}
                              aria-label={`View ${c.name} details`}
                            >
                              <c.icon size={25} />
                              <span>
                                <strong>{c.name}</strong>
                                <small>{c.description}</small>
                              </span>
                              <Plus size={15} />
                            </Button>
                          </Card>
                        ))}
                      </div>
                    </section>
                  )
                );
              })}
              {!connectionItems.length && (
                <p className="catalog-empty">No connectors match your search.</p>
              )}
            </div>
          </div>
        )}
        {page === "customize" && custom === "Instructions" && (
          <div className="polar-instructions">
            <DesktopSettingsSection
              title="Instructions"
              description="What should Misty know on every task? Add context about you, how you like things done, and things to avoid. You can update these instructions at any time."
              surface="plain"
            >
              <Textarea
                aria-label="Instructions for Misty"
                value={instructions}
                placeholder={"e.g. “Keep answers short and direct.”"}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <div className="instructions-save">
                <Button
                  disabled={!instructions.trim()}
                  onClick={() => setNotice("Instructions saved for this preview.")}
                >
                  Save
                </Button>
              </div>
            </DesktopSettingsSection>
          </div>
        )}
        {page === "customize" && custom === "Skills" && (
          <div className="polar-skills">
            <aside>
              <header>
                <h2>Skills</h2>
                <IconButton label="About skills" onClick={() => setEditingSkill(false)}>
                  <HelpCircle />
                </IconButton>
                <span className="flex-spacer" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNotice("Import a skill file in the production flow.")}
                >
                  <Import size={13} />
                  Import
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setSkill("");
                    setEditingSkill(true);
                  }}
                >
                  New <ChevronDown size={12} />
                </Button>
              </header>
              <div className="skill-label">
                <span>Suggested</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onNavigate("templates");
                    setSub("Skills");
                  }}
                >
                  See more <ArrowRight size={12} />
                </Button>
              </div>
              {skillNames.map((s) => (
                <Button
                  variant="ghost"
                  justify="start"
                  key={s}
                  onClick={() => setDetail({ name: s, category: "Skills", apps: ["Journal"] })}
                >
                  {s}
                </Button>
              ))}
              <div className="skill-label own-skills">Your skills</div>
              {skill && !editingSkill ? (
                <Button variant="ghost" justify="start" onClick={() => setEditingSkill(true)}>
                  {skill}
                </Button>
              ) : (
                <p className="skill-none">None yet</p>
              )}
            </aside>
            {editingSkill ? (
              <div className="skill-editor">
                <h2>New skill</h2>
                <label>
                  Name
                  <Input
                    value={skill || ""}
                    onChange={(e) => setSkill(e.target.value)}
                    placeholder="Research with sources"
                  />
                </label>
                <label>
                  Instructions
                  <Textarea placeholder="When should Misty use this skill? What should it do?" />
                </label>
                <Button
                  onClick={() => {
                    setSkill(skill || "Research with sources");
                    setEditingSkill(false);
                    setNotice("Skill added to this preview.");
                  }}
                >
                  Save skill
                </Button>
              </div>
            ) : (
              <div className="skills-empty">
                <FileText size={31} />
                <h2>Skills</h2>
                <p>
                  Skills are know-how Misty uses when a task calls for it.
                  <br />
                  For example, writing in your voice or researching a topic.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="polar-dialog template-dialog">
          <DialogTitle>
            <BookOpen size={22} />
            {detail?.name}
          </DialogTitle>
          <DialogDescription>
            {detail?.category === "Skills"
              ? "Reusable guidance for a familiar kind of work."
              : "A starting point you can tailor before Misty gets to work."}
          </DialogDescription>
          <div className="detail-tags">
            <span>For personal work</span>
            <span>For teams</span>
            <span>For everyone</span>
          </div>
          <label>{detail?.category === "Skills" ? "Instructions" : "Prompt"}</label>
          <div className="template-prompt">
            <p>{detail?.name}.</p>
            <p>
              Start by understanding what I need to decide or accomplish. Ask a question if a
              missing detail would change the result.
            </p>
            <p>
              Use the context I attach and read original sources. Keep facts separate from
              assumptions and link to the evidence.
            </p>
            <p>
              Give me the useful answer first, followed by key findings, open questions, and
              suggested next steps. Prepare a draft for my review.
            </p>
          </div>
          <label>Context</label>
          <div className="detail-apps">
            <Globe size={18} />
            <FileText size={18} />
          </div>
          <div className="detail-actions">
            <Button
              onClick={() => {
                if (detail?.category === "Skills") {
                  setSkill(detail.name);
                  setDetail(null);
                  setNotice("Skill added to this preview.");
                } else if (detail) {
                  onUse(promptFor(detail));
                  setDetail(null);
                }
              }}
            >
              {detail?.category === "Skills" ? <Plus size={15} /> : <FileText size={15} />}{" "}
              {detail?.category === "Skills" ? "Add to my skills" : "Use this template"}
            </Button>
            {detail?.category !== "Skills" && (
              <Button variant="outline" onClick={() => detail && openWorkflow(detail)}>
                <CalendarClock size={15} />
                Save as workflow
              </Button>
            )}
          </div>
          <div className="related-templates">
            <span>Related templates</span>
            {taskTemplates.slice(6, 9).map((t) => (
              <button key={t.name} onClick={() => setDetail(t)}>
                {t.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={workflow} onOpenChange={setWorkflow}>
        <DialogContent className="polar-dialog workflow-dialog">
          <DialogTitle>Save workflow</DialogTitle>
          <DialogDescription className="sr-only">
            Save reusable task instructions in this mockup.
          </DialogDescription>
          <label>
            Command
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="weekly-brief"
            />
          </label>
          <label>
            Description
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of this workflow"
            />
          </label>
          <label>
            Instructions
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Instructions for Misty…"
            />
          </label>
          <label>Schedule</label>
          {schedule ? (
            <div className="schedule-fields">
              <OptionSelect
                value="weekly"
                onValueChange={() => {}}
                options={[{ value: "weekly", label: "Every week" }]}
              />
              <Input aria-label="Schedule time" type="time" defaultValue="09:00" />
              <IconButton label="Remove schedule" onClick={() => setSchedule(false)}>
                <X />
              </IconButton>
            </div>
          ) : (
            <Button
              className="add-schedule"
              variant="outline"
              size="sm"
              onClick={() => setSchedule(true)}
            >
              <Plus size={13} />
              Add schedule
            </Button>
          )}
          <footer>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNotice("Balanced effort selected for the preview.")}
            >
              <SlidersHorizontal size={13} />
              Balanced
              <ChevronDown size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNotice("Context attachments would be included with each run.")}
            >
              <Plus size={13} />
              Attach context
            </Button>
            <span className="flex-spacer" />
            <Button variant="ghost" onClick={() => setWorkflow(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setSaved((a) => [...a, description || command || "Untitled workflow"]);
                setWorkflow(false);
                setNotice("Workflow saved in this preview. No automation scheduled.");
              }}
            >
              Save workflow
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
      <Dialog open={!!connection} onOpenChange={(open) => !open && setConnection(null)}>
        <DialogContent className="polar-dialog connector-dialog">
          <DialogTitle>{connection}</DialogTitle>
          <DialogDescription>Example connector · no account connected</DialogDescription>
          <p>
            Choose the apps Misty can use for a task. Context and access would be reviewed when you
            connect an account.
          </p>
          <Button
            onClick={() => {
              setConnection(null);
              setNotice("Connection flow is illustrative. No account was connected.");
            }}
          >
            Preview connection
          </Button>
        </DialogContent>
      </Dialog>
      {notice && (
        <div className="page-notice" role="status">
          {notice}
          <IconButton label="Dismiss" onClick={() => setNotice("")}>
            <X />
          </IconButton>
        </div>
      )}
    </div>
  );
}
