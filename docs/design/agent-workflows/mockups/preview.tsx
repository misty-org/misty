import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Copy,
  FileText,
  Folder,
  Globe,
  LayoutGrid,
  List,
  LoaderCircle,
  Mail,
  Maximize2,
  Mic,
  Monitor,
  MoreHorizontal,
  PanelLeft,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  Moon,
  WandSparkles,
  Workflow,
  X,
  Cable,
  MessageSquare,
  ShieldCheck,
  Keyboard,
  RefreshCw,
  MousePointer2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/shared/ui/controls/Button";
import { IconButton } from "@/shared/ui/controls/IconButton";
import { Input } from "@/shared/ui/controls/Input";
import { Textarea } from "@/shared/ui/controls/Textarea";
import { OptionSelect } from "@/shared/ui/controls/OptionSelect";
import { Card } from "@/shared/ui/display/Card";
import { MessageComposer, MessageComposerSend } from "@/shared/ui/patterns/MessageComposer";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/shared/ui/overlays/Dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/shared/ui/overlays/DropdownMenu";
import {
  DesktopSettingsSection,
  DesktopSettingsRow,
} from "@/features/settings/components/DesktopSettingsUI";
import { SwitchControl } from "@/features/settings/SettingsControls";
import sky from "@/shared/assets/agents/cloud-sky-poster.webp";
import "@/styles/styles.css";
import "./preview.css";

type Screen = "new" | "run" | "workflows" | "templates" | "customize" | "companion";
const screens: { id: Screen; label: string }[] = [
  { id: "new", label: "New task" },
  { id: "run", label: "Task + browser" },
  { id: "workflows", label: "Workflows" },
  { id: "templates", label: "Templates" },
  { id: "customize", label: "Customize" },
  { id: "companion", label: "Companion" },
];
const templates = [
  {
    name: "Your week, in focus",
    body: "Turn tasks, meetings, and notes into a plan you can actually use.",
    category: "Planning",
    icon: CalendarClock,
    context: "Planner · Journal",
    prompt:
      "Review my upcoming week and create a short plan with my priorities, meetings, and time to focus.",
  },
  {
    name: "A clearer competitor picture",
    body: "Compare product updates and pricing, with a source for every finding.",
    category: "Research",
    icon: Globe,
    context: "Browser · Library",
    prompt:
      "Research these competitors and save a comparison in my Product research Space. Cite each source and separate new findings from previous updates.",
  },
  {
    name: "A page becomes a spreadsheet",
    body: "Collect the details from a directory, listing, or results page.",
    category: "Research",
    icon: LayoutGrid,
    context: "Current tab · Files",
    prompt:
      "Extract the entries on this page into a CSV, include source URLs, and tell me which pages you could not read.",
  },
  {
    name: "Walk into every meeting ready",
    body: "Bring together the context, open questions, and decisions you need.",
    category: "Planning",
    icon: MessageSquare,
    context: "Calendar · Spaces",
    prompt:
      "Prepare a meeting brief from my calendar and the related Space. Include decisions needed and outstanding questions.",
  },
  {
    name: "Notes with a next step",
    body: "Pull decisions and follow-ups out of a transcript or rough notes.",
    category: "Writing",
    icon: FileText,
    context: "Journal · Planner",
    prompt:
      "Turn these notes into a concise summary with decisions and suggested tasks for my review.",
  },
  {
    name: "A first draft that sounds like you",
    body: "Shape an outline into a clear draft using your writing preferences.",
    category: "Writing",
    icon: SquarePen,
    context: "Journal · Skills",
    prompt:
      "Write a first draft using my outline and writing preferences. Flag anything that needs a source.",
  },
];
const initialWorkflows = [
  {
    name: "Weekly competitor brief",
    command: "/competitor-brief",
    schedule: "Mondays at 9:00 AM",
    last: "Today, 9:04 AM",
    icon: Globe,
  },
  {
    name: "Morning overview",
    command: "/morning",
    schedule: "Weekdays at 8:00 AM",
    last: "Today, 8:01 AM",
    icon: Sun,
  },
  {
    name: "Meeting preparation",
    command: "/meeting-prep",
    schedule: "On demand",
    last: "Yesterday, 2:15 PM",
    icon: MessageSquare,
  },
  {
    name: "Friday reflection",
    command: "/weekly-review",
    schedule: "Fridays at 4:00 PM",
    last: "Sep 25, 4:02 PM",
    icon: BookOpen,
  },
];

function App() {
  const param = new URLSearchParams(location.search).get("screen") as Screen;
  const [screen, setScreen] = useState<Screen>(screens.some((s) => s.id === param) ? param : "new");
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    document.documentElement.dataset.mockTheme = theme;
  }, [theme]);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState("");
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState("Northstar");
  const [workflow, setWorkflow] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [workflowName, setWorkflowName] = useState("Weekly competitor brief");
  const [workflowPrompt, setWorkflowPrompt] = useState(
    "Review Northstar, Outline, and Forma for product and pricing updates. Compare changes with the previous brief, cite every source, and save the result in Product research.",
  );
  const [cadence, setCadence] = useState("weekly");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<(typeof templates)[number] | null>(null);
  const [custom, setCustom] = useState("Connectors");
  const [skill, setSkill] = useState("Research with sources");
  const [instructions, setInstructions] = useState(
    "Keep answers clear and direct.\n\nWhen researching, link to original sources and distinguish facts from assumptions.\n\nSave finished research to the Product research Space.",
  );
  const [enabled, setEnabled] = useState(true);
  const [effort, setEffort] = useState("Balanced");
  const [agent, setAgent] = useState("Misty");
  const [space, setSpace] = useState("Product research");
  const [connection, setConnection] = useState<string | null>(null);
  const go = (next: Screen) => {
    setScreen(next);
    setSearch("");
    setCategory("All");
    setToast("");
    history.replaceState(null, "", `?screen=${next}`);
  };
  const note = (s: string) => {
    setToast(s);
  };
  const run = () => {
    setPaused(false);
    go("run");
  };
  const nav = (name: string, icon: LucideIcon, target: Screen) => {
    const Icon = icon;
    return (
      <Button
        variant="ghost"
        justify="start"
        className={`side-link ${screen === target ? "selected" : ""}`}
        onClick={() => go(target)}
      >
        <Icon />
        {!collapsed && name}
      </Button>
    );
  };
  const chooser = (
    label: string,
    value: string,
    values: string[],
    change: (s: string) => void,
    Icon: LucideIcon,
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          <Icon />
          {value}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {values.map((v) => (
          <DropdownMenuItem key={v} onSelect={() => change(v)}>
            <span className="w-4">{v === value && <Check className="size-3.5" />}</span>
            {v}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const composer = (followup = false) => (
    <div className="composer-wrap">
      <MessageComposer
        className="task-composer"
        inputProps={{
          "aria-label": followup ? "Follow-up instructions" : "Task instructions",
          placeholder: followup
            ? "Guide Misty, ask a question, or change direction…"
            : "Describe your task, / for workflows, @ for context",
          value: draft,
          onChange: (e) => setDraft(e.target.value),
        }}
        footer={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Attach context">
                  <Plus />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => note("Current browser tab attached to this mockup.")}
                >
                  <Globe />
                  Current tab
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => go("templates")}>
                  <BookOpen />
                  Use a template
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => go("workflows")}>
                  <Workflow />
                  Choose a workflow
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setCustom("Skills");
                    go("customize");
                  }}
                >
                  <WandSparkles />
                  Choose a skill
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {chooser(
              "Choose effort",
              effort,
              ["Quick", "Balanced", "Thorough"],
              setEffort,
              SlidersHorizontal,
            )}
            <span className="grow" />
            {chooser("Choose agent", agent, ["Misty", "Research assistant"], setAgent, Cloud)}
            <IconButton label="Voice input" onClick={() => go("companion")}>
              <Mic />
            </IconButton>
            <MessageComposerSend label={followup ? "Send follow-up" : "Start task"} onClick={run} />
          </>
        }
      />
      {!followup && (
        <div className="composer-project">
          {chooser(
            "Choose Space",
            space,
            ["Product research", "Personal", "Launch planning"],
            setSpace,
            Folder,
          )}
          <span>Context stays with your task</span>
        </div>
      )}
    </div>
  );
  const title = (heading: string, description: string, action?: React.ReactNode) => (
    <header className="page-title">
      <div>
        <h1>{heading}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
  const browser = (
    <section className="agent-browser" aria-label="Agent browser">
      <div className="browser-tabs">
        {["Northstar", "Outline", "Forma"].map((t) => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            className={tab === t ? "active-browser-tab" : ""}
            onClick={() => setTab(t)}
          >
            <Globe />
            {t}
          </Button>
        ))}
        <IconButton
          label="Add research tab"
          onClick={() => note("A new tab would join this task’s browser workspace.")}
        >
          <Plus />
        </IconButton>
      </div>
      <div className="address">
        <ArrowLeft size={15} />
        <ArrowRight size={15} />
        <RefreshCw size={14} />
        <span>
          <ShieldCheck size={13} />
          {tab.toLowerCase()}.example / changelog
        </span>
        <IconButton
          label="Expand browser"
          onClick={() =>
            note("Browser expanded in the production design; this is a layout preview.")
          }
        >
          <Maximize2 />
        </IconButton>
      </div>
      <div className="example-site">
        <div className="site-nav">
          <strong>
            {tab.toLowerCase()}
            <span>®</span>
          </strong>
          <span>Product &nbsp;&nbsp; Changelog &nbsp;&nbsp; Company</span>
        </div>
        <div className="site-story">
          <p className="site-breadcrumb">Product / Updates</p>
          <h2>
            A little less busywork.
            <br />A lot more room to think.
          </h2>
          <p>The latest improvements to your team’s everyday work.</p>
          <div className="release">
            <span>October 1, 2026</span>
            <h3>One home for every project</h3>
            <p>
              Keep conversations, documents, and next steps together. Our updated project workspace
              makes it easier to see what matters and pick up where you left off.
            </p>
            <div className="site-product">
              <div className="mini-side">
                Workspace
                <br />
                <br />
                Overview
                <br />
                Projects
                <br />
                Documents
              </div>
              <div className="mini-main">
                <strong>Website launch</strong>
                <p>Everything moving forward, together.</p>
                {[
                  "Finalize the product story",
                  "Review the launch checklist",
                  "Share the team briefing",
                ].map((t) => (
                  <div key={t}>
                    <Check size={12} />
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="release second">
            <span>September 24, 2026</span>
            <h3>Reporting that comes to you</h3>
          </div>
        </div>
      </div>
      <div className="browser-status">
        <Monitor size={14} />
        {paused ? "Paused · You can use this page" : "Misty is reading this page"}
        <span className="grow" />
        <span>3 tabs in this task</span>
      </div>
    </section>
  );
  const runScreen = (
    <div className="run-layout">
      <section className="conversation">
        <header className="conversation-header">
          <div>
            <Cloud size={17} />
            <strong>Weekly competitor brief</strong>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Task actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  setEditing(true);
                  setWorkflowName("Weekly competitor brief");
                }}
              >
                <Workflow />
                Save as workflow
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => note("Link copied in this mockup.")}>
                <Copy />
                Copy task link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="transcript">
          <div className="user-message">
            Compare this week’s updates from Northstar, Outline, and Forma. Save a brief in Product
            research.
          </div>
          <div className="agent-message">
            <div className="speaker">
              <img src={sky} alt="Misty" />
              <strong>Misty</strong>
              <span>2 min ago</span>
            </div>
            <p>
              I’ll check their latest releases and pricing, then highlight what changed since your
              last brief.
            </p>
            <div className="steps">
              <div>
                <Check />
                Read the previous competitor brief<span>Library</span>
              </div>
              <div>
                <Check />
                Checked Outline and Forma<span>2 sources</span>
              </div>
              <div className="current-step">
                {paused ? <Pause /> : <LoaderCircle className="spin" />}
                <strong>{paused ? "Research paused" : "Reading Northstar’s changelog"}</strong>
                <span>Browser</span>
              </div>
            </div>
            <h3>Two changes worth a closer look</h3>
            <p>
              Northstar has brought project discussions and documents into one workspace. Outline
              added scheduled reports.
            </p>
            <div className="source-links">
              <Button variant="outline" size="xs" onClick={() => setTab("Northstar")}>
                1 · Northstar <ArrowUpRight />
              </Button>
              <Button variant="outline" size="xs" onClick={() => setTab("Outline")}>
                2 · Outline <ArrowUpRight />
              </Button>
            </div>
            <div className="output-preview">
              <FileText />
              <div>
                <strong>Weekly competitor brief</strong>
                <span>Preparing in Product research</span>
              </div>
              <ArrowUpRight size={16} />
            </div>
          </div>
        </div>
        <div className="run-controls">
          <span>
            {paused ? <Pause size={14} /> : <LoaderCircle size={14} className="spin" />}
            {paused ? "Paused for you" : "Checking the remaining sources"}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? <Play /> : <Pause />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPaused(true);
              note("Task stopped in this mockup. Existing results remain available.");
            }}
          >
            Stop
          </Button>
        </div>
        <div className="followup">{composer(true)}</div>
      </section>
      {browser}
    </div>
  );
  return (
    <div className={`prototype ${theme === "light" ? "light" : ""}`}>
      <div className="app-shell">
        <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
          <div className="sidebar-brand">
            <Cloud size={23} />
            {!collapsed && <strong>Misty</strong>}
            <span className="grow" />
            <IconButton label="Toggle sidebar" onClick={() => setCollapsed(!collapsed)}>
              <PanelLeft />
            </IconButton>
          </div>
          <nav aria-label="Agent workspace">
            {nav("New task", SquarePen, "new")}
            {nav("Workflows", Workflow, "workflows")}
            {nav("Templates", LayoutGrid, "templates")}
            {nav("Customize", Settings2, "customize")}
          </nav>
          {!collapsed && (
            <>
              <div className="side-section">
                <div className="side-label">
                  Spaces
                  <IconButton
                    size="xs"
                    label="Open Spaces"
                    onClick={() => note("Spaces bring tasks, files, and workflows together.")}
                  >
                    <Plus />
                  </IconButton>
                </div>
                <Button
                  variant="ghost"
                  justify="start"
                  onClick={() => {
                    setSpace("Product research");
                    go("new");
                  }}
                >
                  <Folder />
                  Product research
                </Button>
                <Button
                  variant="ghost"
                  justify="start"
                  onClick={() => {
                    setSpace("Launch planning");
                    go("new");
                  }}
                >
                  <Folder />
                  Launch planning
                </Button>
              </div>
              <div className="side-section">
                <div className="side-label">
                  Recent tasks
                  <ChevronDown size={13} />
                </div>
                {[
                  "Weekly competitor brief",
                  "Prepare for the design review",
                  "A plan for next week",
                ].map((n, i) => (
                  <Button
                    key={n}
                    variant="ghost"
                    justify="start"
                    className={screen === "run" && i === 0 ? "selected" : ""}
                    onClick={run}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <div className="sidebar-bottom">
                <Button variant="ghost" justify="start" onClick={() => go("companion")}>
                  <AudioLines />
                  Ask your companion
                </Button>
                <div>
                  <Keyboard size={13} />
                  <span>Option + Space</span>
                </div>
              </div>
            </>
          )}
        </aside>
        <div className="workspace">
          <div className="chrome">
            <Button variant="ghost" size="sm" className="chrome-tab" onClick={() => go("new")}>
              <Cloud />
              Agents
              <X size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => note("Product research Space selected for this mockup.")}
            >
              <Folder />
              Product research
            </Button>
            <IconButton label="New workspace tab" onClick={() => go("new")}>
              <Plus />
            </IconButton>
            <span className="grow" />
            <IconButton
              label="Search workspace"
              onClick={() => {
                go("templates");
                setTimeout(
                  () =>
                    document
                      .querySelector<HTMLInputElement>('[aria-label="Search templates"]')
                      ?.focus(),
                  0,
                );
              }}
            >
              <Search />
            </IconButton>
            <span className="account-avatar">M</span>
          </div>
          <main className="main-surface">
            {screen === "new" && (
              <div className="home">
                <div className="home-center">
                  <img className="home-cloud" src={sky} alt="Misty companion" />
                  <h1>What can I take off your hands?</h1>
                  <p>From a quick question to a whole afternoon of work.</p>
                  {composer()}
                  <div className="starter-links">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraft(templates[1].prompt);
                      }}
                    >
                      <Globe />
                      Research something
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDraft(templates[0].prompt)}>
                      <CalendarClock />
                      Plan my week
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => go("templates")}>
                      <LayoutGrid />
                      Explore templates
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
                <div className="home-recent">
                  <div className="section-line">
                    <h2>Pick up where you left off</h2>
                    <Button variant="ghost" size="sm" onClick={run}>
                      View all
                      <ArrowRight />
                    </Button>
                  </div>
                  <button className="recent-item" onClick={run}>
                    <Globe />
                    <div>
                      <strong>Weekly competitor brief</strong>
                      <span>Product research · 3 sources collected</span>
                    </div>
                    <span>Today</span>
                    <ChevronRight />
                  </button>
                  <button className="recent-item" onClick={run}>
                    <FileText />
                    <div>
                      <strong>Prepare for the design review</strong>
                      <span>Launch planning · Brief ready to review</span>
                    </div>
                    <span>Yesterday</span>
                    <ChevronRight />
                  </button>
                </div>
              </div>
            )}
            {screen === "run" && runScreen}
            {screen === "workflows" && (
              <div className="workflow-layout">
                <div className="page-scroll">
                  <div className="page-inner">
                    {title(
                      "Workflows",
                      "Good work, ready to happen again.",
                      <Button
                        variant="primary"
                        onClick={() => {
                          setWorkflowName("");
                          setWorkflowPrompt("");
                          setEditing(true);
                        }}
                      >
                        <Plus />
                        New workflow
                      </Button>,
                    )}
                    <div className="collection-bar">
                      <div className="section-tabs">
                        {["All", "Scheduled", "On demand"].map((c) => (
                          <Button
                            key={c}
                            variant="ghost"
                            aria-pressed={category === c}
                            onClick={() => setCategory(c)}
                          >
                            {c}
                          </Button>
                        ))}
                      </div>
                      <div className="search-field">
                        <Search size={15} />
                        <Input
                          aria-label="Search workflows"
                          placeholder="Search workflows"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="workflow-table">
                      <div className="table-head">
                        <span>Workflow</span>
                        <span>Runs</span>
                        <span>Last completed</span>
                      </div>
                      {initialWorkflows
                        .filter(
                          (w) =>
                            w.name.toLowerCase().includes(search.toLowerCase()) &&
                            (category === "On demand"
                              ? w.schedule === "On demand"
                              : category === "Scheduled"
                                ? w.schedule !== "On demand"
                                : true),
                        )
                        .map((w) => {
                          const i = initialWorkflows.indexOf(w);
                          const Icon = w.icon;
                          return (
                            <button
                              key={w.name}
                              className={`workflow-row ${workflow === i ? "active" : ""}`}
                              onClick={() => setWorkflow(i)}
                            >
                              <div>
                                <Icon />
                                <div>
                                  <strong>{w.name}</strong>
                                  <span>{w.command}</span>
                                </div>
                              </div>
                              <span>{w.schedule}</span>
                              <span>
                                {w.last}
                                <ChevronRight size={15} />
                              </span>
                            </button>
                          );
                        })}
                    </div>
                    <div className="workflow-note">
                      <Workflow size={18} />
                      <div>
                        <strong>Start with something you already do.</strong>
                        <p>Save a task as a workflow, or find a starting point in Templates.</p>
                      </div>
                      <Button variant="outline" onClick={() => go("templates")}>
                        Browse templates
                        <ArrowRight />
                      </Button>
                    </div>
                  </div>
                </div>
                {workflow !== null && (
                  <aside className="detail-panel">
                    <header>
                      <h2>{initialWorkflows[workflow].name}</h2>
                      <IconButton label="Close workflow details" onClick={() => setWorkflow(null)}>
                        <X />
                      </IconButton>
                    </header>
                    <p className="muted">{initialWorkflows[workflow].command}</p>
                    <div className="detail-actions">
                      <Button variant="primary" onClick={run}>
                        <Play />
                        Run now
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setWorkflowName(initialWorkflows[workflow].name);
                          setEditing(true);
                        }}
                      >
                        Edit workflow
                      </Button>
                    </div>
                    <h3>Instructions</h3>
                    <p>
                      Review the latest product and pricing updates. Compare with the previous
                      brief, cite every source, and save the result to Product research.
                    </p>
                    <h3>Context</h3>
                    <div className="detail-line">
                      <Cloud />
                      Misty
                    </div>
                    <div className="detail-line">
                      <Folder />
                      Product research
                    </div>
                    <div className="detail-line">
                      <BookOpen />
                      Research with sources
                    </div>
                    <h3>Schedule</h3>
                    <div className="detail-line">
                      <CalendarClock />
                      {initialWorkflows[workflow].schedule}
                    </div>
                    <p className="muted">America/Los_Angeles</p>
                    <h3>Recent runs</h3>
                    {["Today, 9:04 AM", "Sep 28, 9:03 AM", "Sep 21, 9:05 AM"].map((d) => (
                      <button className="history-row" key={d} onClick={run}>
                        <Check />
                        <span>{d}</span>
                        <ChevronRight />
                      </button>
                    ))}
                  </aside>
                )}
              </div>
            )}
            {screen === "templates" && (
              <div className="page-scroll">
                <div className="page-inner">
                  {title(
                    "A head start on almost anything",
                    "Choose a task. Make it yours. Let Misty take it from there.",
                  )}
                  <div className="search-field large">
                    <Search />
                    <Input
                      aria-label="Search templates"
                      placeholder="What would you like to get done?"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="template-categories">
                    {["All", "Research", "Planning", "Writing"].map((c) => (
                      <Button
                        key={c}
                        variant="ghost"
                        aria-pressed={category === c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </Button>
                    ))}
                  </div>
                  <h2 className="collection-heading">Made for your everyday work</h2>
                  <div className="template-grid">
                    {templates
                      .filter(
                        (t) =>
                          (["All", "Scheduled", "On demand"].includes(category) ||
                            t.category === category) &&
                          (t.name + " " + t.body).toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((t) => {
                        const Icon = t.icon;
                        return (
                          <Card key={t.name} className="template-card">
                            <button onClick={() => setSelectedTemplate(t)}>
                              <Icon className="template-icon" />
                              <h3>{t.name}</h3>
                              <p>{t.body}</p>
                              <div>
                                <span>{t.context}</span>
                                <ArrowUpRight size={16} />
                              </div>
                            </button>
                          </Card>
                        );
                      })}
                  </div>
                  <div className="template-bottom">
                    <BookOpen />
                    <div>
                      <h3>Give Misty your way of doing things.</h3>
                      <p>
                        Skills bring your research methods, writing style, and repeatable procedures
                        to every task.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCustom("Skills");
                        go("customize");
                      }}
                    >
                      Explore skills
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {screen === "customize" && (
              <div className="customize-layout">
                <aside className="custom-nav">
                  <h2>Customize</h2>
                  <div className="search-field">
                    <Search size={14} />
                    <Input
                      aria-label="Search customization"
                      placeholder="Search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {[
                    ["Connectors", Cable],
                    ["Instructions", FileText],
                    ["Skills", BookOpen],
                    ["Agents", Cloud],
                  ]
                    .filter(([s]) => String(s).toLowerCase().includes(search.toLowerCase()))
                    .map(([s, I]) => {
                      const Icon = I as LucideIcon;
                      return (
                        <Button
                          key={String(s)}
                          variant="ghost"
                          justify="start"
                          aria-pressed={custom === s}
                          onClick={() => setCustom(String(s))}
                        >
                          <Icon />
                          {String(s)}
                        </Button>
                      );
                    })}
                  <hr />
                  <Button variant="ghost" justify="start" onClick={() => setCustom("Companion")}>
                    <AudioLines />
                    Companion
                  </Button>
                </aside>
                <div className="page-scroll">
                  <div className="custom-content">
                    {custom === "Connectors" ? (
                      <>
                        {title(
                          "Connectors",
                          "Bring your tools into the conversation.",
                          <Button
                            variant="outline"
                            onClick={() => setConnection("Custom MCP server")}
                          >
                            <Plus />
                            Add custom
                          </Button>,
                        )}
                        <DesktopSettingsSection title="Connected apps" surface="plain">
                          {[
                            ["Misty", "Spaces, Planner, Journal, and Library", Cloud],
                            ["Google", "Gmail, Calendar, Drive, and Docs", Mail],
                            ["GitHub", "Repositories, issues, and pull requests", Globe],
                          ].map(([n, d, I]) => {
                            const Icon = I as LucideIcon;
                            return (
                              <div className="connector-row" key={String(n)}>
                                <Icon />
                                <div>
                                  <strong>{String(n)}</strong>
                                  <span>{String(d)}</span>
                                </div>
                                <span className="connection-state">
                                  <Check size={13} />
                                  Connected
                                </span>
                                <IconButton
                                  label={`Manage ${n}`}
                                  onClick={() => setConnection(String(n))}
                                >
                                  <ChevronRight />
                                </IconButton>
                              </div>
                            );
                          })}
                        </DesktopSettingsSection>
                        <h2 className="collection-heading">Find another connection</h2>
                        <div className="connectors-grid">
                          {[
                            ["Slack", "Messages and team conversations", MessageSquare],
                            ["Notion", "Pages, documents, and databases", FileText],
                            ["Linear", "Issues and project updates", List],
                            ["Custom tools", "Connect a remote MCP server", Cable],
                          ].map(([n, d, I]) => {
                            const Icon = I as LucideIcon;
                            return (
                              <button
                                key={String(n)}
                                className="connector-tile"
                                onClick={() => setConnection(String(n))}
                              >
                                <Icon />
                                <div>
                                  <strong>{String(n)}</strong>
                                  <span>{String(d)}</span>
                                </div>
                                <Plus size={15} />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : custom === "Instructions" ? (
                      <>
                        {title("Instructions", "A little context makes every task more useful.")}
                        <label className="field-label" htmlFor="instructions">
                          What should Misty know?
                        </label>
                        <Textarea
                          id="instructions"
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                          rows={12}
                        />
                        <div className="save-line">
                          <span>Used across your account.</span>
                          <Button
                            variant="primary"
                            onClick={() => note("Instructions saved for this preview only.")}
                          >
                            Save changes
                          </Button>
                        </div>
                        <DesktopSettingsSection title="Remembered preferences" surface="plain">
                          <div className="memory-row">
                            <span>Prefer primary sources when researching.</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => note("Memory review would open here.")}
                            >
                              Review
                            </Button>
                          </div>
                        </DesktopSettingsSection>
                      </>
                    ) : custom === "Skills" ? (
                      <>
                        {title(
                          "Skills",
                          "Your know-how, available whenever it helps.",
                          <Button
                            variant="primary"
                            onClick={() => {
                              setSkill("New skill");
                              note("Edit the skill instructions below.");
                            }}
                          >
                            <Plus />
                            New skill
                          </Button>,
                        )}
                        <div className="skills-layout">
                          <div className="skill-list">
                            {["Research with sources", "Write in my voice", "Meeting brief"].map(
                              (s) => (
                                <Button
                                  key={s}
                                  variant="ghost"
                                  justify="start"
                                  aria-pressed={skill === s}
                                  onClick={() => setSkill(s)}
                                >
                                  <BookOpen />
                                  {s}
                                </Button>
                              ),
                            )}
                          </div>
                          <div className="skill-editor">
                            <h2>{skill}</h2>
                            <p className="muted">
                              Use when researching products, companies, or a decision.
                            </p>
                            <label className="field-label" htmlFor="skill-body">
                              Instructions
                            </label>
                            <Textarea
                              id="skill-body"
                              key={skill}
                              defaultValue={
                                "Start with original sources.\n\nFor each finding, keep the source URL and date. Separate confirmed facts from assumptions.\n\nCompare against existing research in the Space. Call out what changed and why it matters.\n\nFinish with a concise recommendation and open questions."
                              }
                              rows={12}
                            />
                            <div className="save-line">
                              <span>Available to Misty</span>
                              <Button
                                variant="primary"
                                onClick={() => note("Skill saved for this preview only.")}
                              >
                                Save skill
                              </Button>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : custom === "Agents" ? (
                      <>
                        {title("Agents", "Familiar collaborators for different kinds of work.")}
                        <div className="agent-profile">
                          <img src={sky} alt="Misty" />
                          <div>
                            <h2>Misty</h2>
                            <p>Your everyday companion</p>
                          </div>
                          <Button variant="outline" onClick={() => setCustom("Instructions")}>
                            Edit instructions
                          </Button>
                        </div>
                        <DesktopSettingsSection title="Defaults">
                          <DesktopSettingsRow
                            label="Effort"
                            description="How deeply Misty works through a task."
                          >
                            <OptionSelect
                              aria-label="Default effort"
                              value={effort}
                              onValueChange={setEffort}
                              options={["Quick", "Balanced", "Thorough"].map((v) => ({
                                value: v,
                                label: v,
                              }))}
                            />
                          </DesktopSettingsRow>
                          <DesktopSettingsRow
                            label="Completion notifications"
                            description="Know when your work is ready."
                          >
                            <SwitchControl
                              checked={enabled}
                              disabled={false}
                              onChange={setEnabled}
                            />
                          </DesktopSettingsRow>
                        </DesktopSettingsSection>
                      </>
                    ) : (
                      <>
                        {title("Companion", "Misty, close at hand.")}
                        <DesktopSettingsSection title="Desktop companion">
                          <DesktopSettingsRow
                            label="Show companion"
                            description="Keep Misty nearby while you work."
                          >
                            <SwitchControl
                              checked={enabled}
                              disabled={false}
                              onChange={setEnabled}
                            />
                          </DesktopSettingsRow>
                          <DesktopSettingsRow
                            label="Ask Misty"
                            description="Start with your voice or the current page."
                          >
                            <Button variant="outline" onClick={() => go("companion")}>
                              <AudioLines />
                              Try the companion
                            </Button>
                          </DesktopSettingsRow>
                        </DesktopSettingsSection>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            {screen === "companion" && (
              <div className="companion-scene">
                <div className="document-pane">
                  <div className="document-toolbar">
                    <Folder size={15} />
                    Product research
                    <ChevronRight size={13} />
                    <span>Launch notes</span>
                    <span className="grow" />
                    <MoreHorizontal size={18} />
                  </div>
                  <article>
                    <span className="document-date">Friday, October 2</span>
                    <h1>
                      The next chapter
                      <br />
                      for Misty.
                    </h1>
                    <p className="document-lead">
                      A calmer place to think. A capable partner to move the work forward.
                    </p>
                    <h2>What we want to learn</h2>
                    <p>
                      How are other products helping people turn a request into finished work? Look
                      at their onboarding, reusable workflows, and the moments where they ask for
                      human input.
                    </p>
                    <div className="selected-passage">
                      Compare Northstar, Outline, and Forma. Find the most useful changes from this
                      week and save a brief with links to the original sources.
                    </div>
                    <h2>Bring it back to the team</h2>
                    <p>
                      Keep the findings practical. What should we build first, and what would make
                      the biggest difference in someone’s day?
                    </p>
                  </article>
                </div>
                <aside className="companion-handoff">
                  <div className="handoff-head">
                    <img src={sky} alt="Misty" />
                    <div>
                      <strong>Misty</strong>
                      <span>Ready when you are</span>
                    </div>
                    <IconButton label="Close companion" onClick={() => go("new")}>
                      <X />
                    </IconButton>
                  </div>
                  <div className="handoff-body">
                    <p>“Research these competitors and make this a weekly brief.”</p>
                    <div className="context-pill">
                      <FileText size={14} />
                      Selected text · Launch notes
                    </div>
                    <p>I’ll use your research skill and save the brief in this Space.</p>
                    <div className="detail-line">
                      <BookOpen />
                      Research with sources
                    </div>
                    <div className="detail-line">
                      <Folder />
                      Product research
                    </div>
                    <Button variant="primary" className="w-full" onClick={run}>
                      Start research
                      <ArrowRight />
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() => {
                        setEditing(true);
                        setWorkflowName("Weekly competitor brief");
                      }}
                    >
                      Review workflow first
                    </Button>
                  </div>
                  <div className="handoff-foot">
                    <AudioLines size={16} />
                    Voice and typed requests become the same task.
                  </div>
                </aside>
                <div className="companion-pointer">
                  <img src={sky} alt="" />
                  <MousePointer2 size={20} />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
      <footer className="review-bar">
        <span>
          <strong>Misty × Polar</strong>
          <span className="review-label">Layout study · illustrative data</span>
        </span>
        <nav aria-label="Mockup screens">
          {screens.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              size="sm"
              aria-pressed={screen === s.id}
              onClick={() => go(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </nav>
        <IconButton
          label="Toggle light and dark theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </IconButton>
      </footer>
      {toast && (
        <div className="preview-toast" role="status">
          <Check size={16} />
          {toast}
          <IconButton label="Dismiss notification" onClick={() => setToast("")}>
            <X />
          </IconButton>
        </div>
      )}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="workflow-dialog">
          <DialogTitle>{workflowName ? "Save workflow" : "New workflow"}</DialogTitle>
          <DialogDescription>A repeatable task, with everything Misty needs.</DialogDescription>
          <label className="field-label" htmlFor="wf-name">
            Name
          </label>
          <Input
            id="wf-name"
            value={workflowName}
            placeholder="Weekly competitor brief"
            onChange={(e) => setWorkflowName(e.target.value)}
          />
          <label className="field-label" htmlFor="wf-prompt">
            Instructions
          </label>
          <Textarea
            id="wf-prompt"
            rows={5}
            value={workflowPrompt}
            onChange={(e) => setWorkflowPrompt(e.target.value)}
          />
          <div className="editor-grid">
            <div>
              <label className="field-label">Agent</label>
              <OptionSelect
                aria-label="Workflow agent"
                value={agent}
                options={["Misty", "Research assistant"].map((v) => ({ value: v, label: v }))}
                onValueChange={setAgent}
              />
            </div>
            <div>
              <label className="field-label">Run</label>
              <OptionSelect
                aria-label="Schedule recurrence"
                value={cadence}
                options={[
                  { value: "manual", label: "On demand" },
                  { value: "weekly", label: "Every Monday" },
                  { value: "daily", label: "Every day" },
                ]}
                onValueChange={setCadence}
              />
            </div>
          </div>
          {cadence !== "manual" && (
            <div className="schedule-line">
              <CalendarClock size={16} />
              <Input aria-label="Scheduled time" type="time" defaultValue="09:00" />
              <span>America/Los_Angeles</span>
            </div>
          )}
          <div className="detail-line">
            <Folder />
            Save results in {space}
          </div>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!workflowName.trim() || !workflowPrompt.trim()}
              onClick={() => {
                setEditing(false);
                go("workflows");
                note("Workflow saved for this preview. No automation has been scheduled.");
              }}
            >
              Save workflow
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedTemplate} onOpenChange={(v) => !v && setSelectedTemplate(null)}>
        <DialogContent className="template-dialog">
          <DialogTitle>{selectedTemplate?.name}</DialogTitle>
          <DialogDescription>{selectedTemplate?.body}</DialogDescription>
          <h3>What Misty will do</h3>
          <p>{selectedTemplate?.prompt}</p>
          <div className="detail-line">
            <Folder />
            {selectedTemplate?.context}
          </div>
          <div className="dialog-actions">
            <Button
              variant="outline"
              onClick={() => {
                setWorkflowName(selectedTemplate?.name || "");
                setWorkflowPrompt(selectedTemplate?.prompt || "");
                setSelectedTemplate(null);
                setEditing(true);
              }}
            >
              Save as workflow
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDraft(selectedTemplate?.prompt || "");
                setSelectedTemplate(null);
                go("new");
              }}
            >
              Use template
              <ArrowRight />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!connection} onOpenChange={(v) => !v && setConnection(null)}>
        <DialogContent>
          <DialogTitle>{connection}</DialogTitle>
          <DialogDescription>Preview the actions available to your agents.</DialogDescription>
          {[
            "Search and read connected content",
            "Create drafts for review",
            "Save completed work to your Space",
          ].map((t) => (
            <div className="detail-line" key={t}>
              <Check />
              {t}
            </div>
          ))}
          <p className="muted">
            Illustrative connection details. This preview does not connect to an account.
          </p>
          <Button variant="primary" onClick={() => setConnection(null)}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
