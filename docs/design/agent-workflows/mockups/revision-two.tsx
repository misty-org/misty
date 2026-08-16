import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  Globe,
  History,
  LayoutGrid,
  LoaderCircle,
  MessageSquare,
  Mic,
  Minus,
  Monitor,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  SquarePen,
  Sun,
  Moon,
  Workflow,
  X,
  ExternalLink,
  Copy,
  BookOpen,
  Cable,
} from "lucide-react";
import { Button } from "@/shared/ui/controls/Button";
import { IconButton } from "@/shared/ui/controls/IconButton";
import { Input } from "@/shared/ui/controls/Input";
import { Textarea } from "@/shared/ui/controls/Textarea";
import { MessageComposer, MessageComposerSend } from "@/shared/ui/patterns/MessageComposer";
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
import "./revision-two.css";

type Scene =
  | "new"
  | "questions"
  | "background"
  | "run"
  | "takeover"
  | "done"
  | "workflows"
  | "templates"
  | "customize";
const scenes: { id: Scene; label: string }[] = [
  { id: "new", label: "Start" },
  { id: "questions", label: "Questions" },
  { id: "background", label: "In background" },
  { id: "run", label: "Agent window" },
  { id: "takeover", label: "This window" },
  { id: "done", label: "Result" },
];
const task =
  "Compare Northstar, Outline, and Forma. Tell me what changed this week and draft a short brief.";
const questions = [
  {
    title: "What should I focus on?",
    options: [
      "Product updates and pricing",
      "Only changes that affect our roadmap",
      "A broad overview of all three",
    ],
  },
  {
    title: "How would you like the brief?",
    options: [
      "A short summary with source links",
      "A side-by-side comparison",
      "A detailed report",
    ],
  },
];
function App() {
  const initial = new URLSearchParams(location.search).get("screen") as Scene;
  const [scene, setScene] = useState<Scene>(
    [...scenes.map((s) => s.id), "workflows", "templates", "customize"].includes(initial)
      ? initial
      : "new",
  );
  const [theme, setTheme] = useState("dark");
  const [draft, setDraft] = useState("");
  const [taskPrompt, setTaskPrompt] = useState(task);
  const [resultOpen, setResultOpen] = useState(true);
  const [mode, setMode] = useState("Separate window");
  const [context, setContext] = useState(false);
  const [effort, setEffort] = useState("Balanced");
  const [panel, setPanel] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [activity, setActivity] = useState(false);
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [customAnswer, setCustomAnswer] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState("Instructions");
  const [askFirst, setAskFirst] = useState(true);
  useEffect(() => {
    document.documentElement.dataset.mockTheme = theme;
  }, [theme]);
  const go = (s: Scene) => {
    setScene(s);
    setToast("");
    setPanel(false);
    setPaused(false);
    setStopped(false);
    setActivity(false);
    setResultOpen(true);
    history.replaceState(null, "", `?screen=${s}`);
  };
  const begin = (prompt?: string) => {
    setTaskPrompt(prompt || draft || task);
    setDraft("");
    setQuestion(0);
    setAnswers([]);
    setCustomAnswer(false);
    go("questions");
  };
  const answer = (value: string) => {
    setDraft("");
    setAnswers((a) => [...a, value]);
    setCustomAnswer(false);
    setAnswerText("");
    if (question === 0) setQuestion(1);
    else go(mode === "This window" ? "takeover" : "background");
  };
  const dropdown = (
    label: string,
    value: string,
    options: string[],
    change: (s: string) => void,
    Icon: typeof Cloud,
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          <Icon size={15} />
          {value}
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => change(s)}>
            <span className="choice-check">{value === s && <Check size={14} />}</span>
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const attach = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Attach context">
          <Plus />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setContext(true)}>
          <Folder />
          Space · Product research
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setToast("Current tab attached for this preview.")}>
          <Globe />
          Current tab
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setToast("File picker is illustrative in this preview.")}>
          <FileText />
          File
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const composer = (kind: "start" | "followup" | "answer" = "start") => (
    <div className={`input-group ${kind}`}>
      {context && (
        <div className="attached-context">
          <Folder size={13} />
          <span>Product research</span>
          <span className="context-label">Context</span>
          <IconButton label="Remove Space context" onClick={() => setContext(false)}>
            <X />
          </IconButton>
        </div>
      )}
      <MessageComposer
        className="v2-composer"
        inputProps={{
          "aria-label":
            kind === "start"
              ? "Task instructions"
              : kind === "answer"
                ? "Reply directly"
                : "Follow-up instructions",
          placeholder:
            kind === "start"
              ? "Ask Misty to do something…"
              : kind === "answer"
                ? "Or reply in your own words…"
                : "Guide Misty or ask a follow-up…",
          value: draft,
          onChange: (e) => setDraft(e.target.value),
        }}
        footer={
          <>
            {attach}
            {dropdown(
              "Thinking options",
              effort,
              ["Quick", "Balanced", "Thorough"],
              setEffort,
              SlidersHorizontal,
            )}
            <span className="flex-spacer" />
            <IconButton
              label="Voice input"
              onClick={() => setToast("Voice input is illustrative in this preview.")}
            >
              <Mic />
            </IconButton>
            <MessageComposerSend
              label={kind === "start" ? "Start task" : "Send message"}
              onClick={() =>
                kind === "start"
                  ? begin()
                  : kind === "answer"
                    ? answer(draft || "Use your judgment")
                    : setToast("Follow-up added to this sample run.")
              }
            />
          </>
        }
      />
      {kind === "start" && (
        <div className="input-meta">
          {dropdown(
            "Where Misty works",
            mode,
            ["Separate window", "This window"],
            setMode,
            Monitor,
          )}
          <span>
            <kbd>/</kbd> workflows <kbd>@</kbd> context
          </span>
        </div>
      )}
    </div>
  );
  const live = scene === "run" || scene === "takeover";
  const status = stopped
    ? "Stopped"
    : paused
      ? "Paused · You have control"
      : "Reading Northstar’s changelog";
  const nav = (label: string, id: Scene, Icon: typeof Cloud) => (
    <Button
      variant="ghost"
      justify="start"
      aria-label={label}
      className={`nav-item ${scene === id ? "selected" : ""}`}
      onClick={() => go(id)}
    >
      <Icon size={17} />
      {!collapsed && label}
    </Button>
  );
  const controls = (
    <>
      <IconButton
        label={paused ? "Resume agent" : "Pause agent"}
        onClick={() => {
          setPaused(!paused);
          setStopped(false);
        }}
      >
        {paused ? <Play /> : <Pause />}
      </IconButton>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setPaused(true);
          setPanel(false);
        }}
      >
        Take over
      </Button>
      <IconButton
        label="Stop agent"
        onClick={() => {
          setStopped(true);
          setPaused(true);
        }}
      >
        <Square />
      </IconButton>
    </>
  );
  const floating = (
    <section className="floating-panel" aria-label="Floating Misty conversation">
      <header>
        <img src={sky} alt="Misty" />
        <strong>Misty</strong>
        <ChevronDown size={13} />
        <span>competitor brief</span>
        <div className="flex-spacer" />
        <IconButton label="Task history" onClick={() => setActivity(!activity)}>
          <History />
        </IconButton>
        <IconButton label="New floating task" onClick={() => go("new")}>
          <Plus />
        </IconButton>
        <IconButton label="Minimize conversation" onClick={() => setPanel(false)}>
          <Minus />
        </IconButton>
      </header>
      {composer("followup")}
      <div className="float-thread">
        <div className="user-message">{taskPrompt}</div>
        <p>
          I’ll compare their latest updates and pull together a short brief with links to the
          sources.
        </p>
        <button
          className="activity-toggle"
          onClick={() => setActivity(!activity)}
          aria-expanded={activity}
        >
          <Globe size={14} />
          <span>Browsed 2 pages</span>
          <ChevronDown size={12} />
        </button>
        {activity && (
          <div className="activity-list">
            <span>
              <Check size={13} /> Read Outline’s release notes
            </span>
            <span>
              <Check size={13} /> Checked Forma’s pricing
            </span>
            <span>
              <Globe size={13} /> Northstar · Changelog
            </span>
          </div>
        )}
        <div className="quiet-progress">
          <span className={paused ? "static-mark" : "thinking-mark"}>
            {paused ? <Pause size={14} /> : <Cloud size={17} />}
          </span>
          <span>{status}</span>
        </div>
        <p className="live-detail">I’m checking which changes are new since the last release.</p>
      </div>
      <footer>
        <span>
          {scene === "run" ? "Working in a separate Misty window" : "Working in this window"}
        </span>
        {controls}
      </footer>
    </section>
  );
  const dock = (
    <div className="run-dock" aria-label="Agent controls">
      <button
        className="dock-main"
        onClick={() => setPanel(!panel)}
        aria-label="Open floating conversation"
      >
        <img src={sky} alt="" />
        <span>
          <strong>{stopped ? "Task stopped" : paused ? "Your turn" : "Misty is working"}</strong>
          <small>{status}</small>
        </span>
        <ChevronDown size={13} />
      </button>
      <div className="dock-divider" />
      {controls}
    </div>
  );
  const browserPage = (
    <div className="research-page">
      <nav>
        <strong>northstar</strong>
        <span>Product &nbsp;&nbsp; Changelog &nbsp;&nbsp; Company</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setToast("Illustrative website in the mockup.")}
        >
          Get started <ArrowUpRight size={13} />
        </Button>
      </nav>
      <article>
        <span className="breadcrumb">Product / Changelog</span>
        <h1>
          A little less busywork.
          <br />
          More room to think.
        </h1>
        <p className="site-intro">The latest improvements to your team’s everyday work.</p>
        <div className="release-entry">
          <time>October 1, 2026</time>
          <div>
            <h2>One home for every project</h2>
            <p>
              Keep conversations, documents, and next steps together. The updated project workspace
              makes it easier to pick up where you left off.
            </p>
            <div className="project-sample">
              <div className="sample-nav">
                Workspace
                <br />
                <br />
                Overview
                <br />
                Projects
                <br />
                Documents
              </div>
              <div>
                <h3>Website launch</h3>
                <p>Everything moving forward, together.</p>
                {[
                  "Finalize the product story",
                  "Review the launch checklist",
                  "Share the team briefing",
                ].map((s) => (
                  <span key={s}>
                    <Check size={12} />
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="release-entry">
          <time>September 24, 2026</time>
          <div>
            <h2>Reporting that comes to you</h2>
            <p>Schedule a weekly update and spend less time putting it together.</p>
          </div>
        </div>
      </article>
    </div>
  );
  const station = (
    <div className="launch-page">
      <div className="launch-center">
        <h1>What should we get done?</h1>
        {composer()}
        <div className="starter-links">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(task);
              setContext(false);
            }}
          >
            <Globe size={15} />
            Research something
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft("Help me plan next week around my priorities.");
            }}
          >
            <SquarePen size={15} />
            Plan my week
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go("templates")}>
            <LayoutGrid size={15} />
            Use a template
          </Button>
        </div>
      </div>
      <section className="recent-tasks">
        <div>
          <h2>Recent tasks</h2>
          <Button variant="ghost" size="sm" onClick={() => go("workflows")}>
            View all <ArrowRight size={14} />
          </Button>
        </div>
        {["Weekly competitor brief", "Prepare for the design review", "A plan for next week"].map(
          (s, i) => (
            <button key={s} onClick={() => go(i === 0 ? "done" : "questions")}>
              <span>{s}</span>
              <small>
                {i === 0
                  ? scene === "background"
                    ? "Working in another window"
                    : "Ready to review"
                  : "Yesterday"}
              </small>
              <ChevronRight size={14} />
            </button>
          ),
        )}
      </section>
    </div>
  );
  const questionsView = (
    <section className="question-page">
      <div className="question-thread">
        <div className="user-message">{taskPrompt}</div>
        <p>I can do that. Two quick details will help me make the brief useful.</p>
        {answers.length > 0 && (
          <div className="answered-question">
            <Check size={14} />
            {answers[0]}
          </div>
        )}
        <span className="waiting-line">
          <MessageSquare size={15} />
          Waiting for your input
        </span>
      </div>
      <div className="question-bottom">
        <section className="question-card">
          <header>
            <span>
              <MessageSquare size={15} />A quick question
            </span>
            <span>
              <IconButton
                label="Previous question"
                disabled={question === 0}
                onClick={() => setQuestion(0)}
              >
                <ChevronLeft />
              </IconButton>
              {question + 1} of 2
              <IconButton
                label="Next question"
                disabled={question === 1}
                onClick={() => setQuestion(1)}
              >
                <ChevronRight />
              </IconButton>
            </span>
          </header>
          <h2>{questions[question].title}</h2>
          <div className="question-options">
            {questions[question].options.map((s, i) => (
              <Button key={s} variant="ghost" justify="start" onClick={() => answer(s)}>
                <kbd>{i + 1}</kbd>
                <span>{s}</span>
                <ChevronRight size={14} />
              </Button>
            ))}
            <Button variant="ghost" justify="start" onClick={() => setCustomAnswer(!customAnswer)}>
              <kbd>4</kbd>
              <span>Something else…</span>
              <Plus size={14} />
            </Button>
          </div>
          {customAnswer && (
            <div className="custom-answer">
              <Input
                aria-label="Your answer"
                value={answerText}
                placeholder="Tell Misty what you have in mind"
                onChange={(e) => setAnswerText(e.target.value)}
              />
              <Button size="sm" onClick={() => answer(answerText || "Use your judgment")}>
                Continue
              </Button>
            </div>
          )}
          <footer>
            <span>Choose an answer or reply below</span>
            <Button variant="ghost" size="sm" onClick={() => answer("Use your judgment")}>
              Skip
            </Button>
          </footer>
        </section>
        {composer("answer")}
      </div>
    </section>
  );
  const doneView = (
    <div className="result-scene">
      <article className="result-document">
        <div className="doc-toolbar">
          <FileText size={16} />
          <span>Weekly competitor brief</span>
          <div className="flex-spacer" />
          <span>Draft</span>
          <MoreHorizontal size={18} />
        </div>
        <div className="document-body">
          <p className="doc-date">October 2, 2026</p>
          <h1>What changed this week</h1>
          <p className="doc-lead">
            Two product changes worth a closer look. No confirmed pricing changes across the three
            sources.
          </p>
          <h2>Northstar brings project work together</h2>
          <p>
            Conversations, documents, and next steps now live in one workspace. This is the largest
            product change in this week’s review.
          </p>
          <a
            href="#sources"
            onClick={(e) => {
              e.preventDefault();
              setToast("Source links are illustrative in this preview.");
            }}
          >
            Northstar changelog <ArrowUpRight size={12} />
          </a>
          <h2>Outline adds scheduled reports</h2>
          <p>
            Teams can now have recurring summaries delivered automatically. It’s a useful reference
            for our workflow experience.
          </p>
          <a href="#sources" onClick={(e) => e.preventDefault()}>
            Outline release notes <ArrowUpRight size={12} />
          </a>
          <h2>What to look at next</h2>
          <p>
            Try the project handoff in Northstar and compare how each product explains recurring
            work.
          </p>
        </div>
      </article>
      {resultOpen ? (
        <section className="completion-panel">
          <header>
            <img src={sky} alt="Misty" />
            <strong>Misty</strong>
            <span>competitor brief</span>
            <IconButton label="Minimize completion" onClick={() => setResultOpen(false)}>
              <X />
            </IconButton>
          </header>
          <div className="completion-content">
            <span className="completion-status">
              <Check size={15} />
              Ready for you
            </span>
            <h2>Your brief is ready.</h2>
            <p>
              I found two product updates and linked the original sources. The draft is open for you
              to review.
            </p>
            <div className="result-file">
              <FileText size={20} />
              <span>
                <strong>Weekly competitor brief</strong>
                <small>Draft · 3 sources</small>
              </span>
              <ArrowUpRight size={15} />
            </div>
            <Button onClick={() => setResultOpen(false)}>
              Review brief <ArrowUpRight size={14} />
            </Button>
            <Button variant="ghost" onClick={() => go("workflows")}>
              <Workflow size={14} />
              Make this a workflow
            </Button>
          </div>
          {composer("followup")}
        </section>
      ) : (
        <Button className="restore-summary" variant="outline" onClick={() => setResultOpen(true)}>
          <Cloud size={16} />
          Brief ready
          <ChevronDown size={13} />
        </Button>
      )}
    </div>
  );
  const library = (
    <div className="library-page">
      <header>
        <h1>
          {scene === "workflows" ? "Workflows" : scene === "templates" ? "Templates" : "Customize"}
        </h1>
        <p>
          {scene === "workflows"
            ? "Tasks you want Misty to do again."
            : scene === "templates"
              ? "A starting point for your next task."
              : "Shape how Misty works with you."}
        </p>
      </header>
      {scene === "customize" ? (
        <div className="custom-layout">
          <nav>
            {["Instructions", "Skills", "Connectors", "Agents"].map((s) => (
              <Button
                key={s}
                variant="ghost"
                justify="start"
                className={custom === s ? "selected" : ""}
                onClick={() => setCustom(s)}
              >
                {s}
              </Button>
            ))}
          </nav>
          <div>
            {custom === "Instructions" ? (
              <>
                <DesktopSettingsSection title="Your instructions">
                  <Textarea
                    aria-label="Your instructions"
                    defaultValue="Keep answers concise. Link to original sources when researching. Ask when a decision needs my judgment."
                  />
                  <Button
                    size="sm"
                    onClick={() => setToast("Instructions saved in this preview only.")}
                  >
                    Save instructions
                  </Button>
                </DesktopSettingsSection>
                <DesktopSettingsSection title="Working together">
                  <DesktopSettingsRow
                    label="Ask before making external changes"
                    description="Pause for review before sending or publishing."
                  >
                    <SwitchControl disabled={false} checked={askFirst} onChange={setAskFirst} />
                  </DesktopSettingsRow>
                </DesktopSettingsSection>
              </>
            ) : (
              <>
                <h2>{custom}</h2>
                {(custom === "Skills"
                  ? ["Research with sources", "My writing voice"]
                  : custom === "Connectors"
                    ? ["Browser", "Misty files", "Calendar"]
                    : ["Misty", "Research assistant"]
                ).map((s) => (
                  <button
                    className="library-row"
                    key={s}
                    onClick={() => setToast(`${s}: configuration is illustrative in this preview.`)}
                  >
                    <span>{s}</span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="library-tools">
            <Input
              aria-label={`Search ${scene}`}
              placeholder={`Search ${scene}…`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {scene === "workflows" && (
              <Button
                onClick={() => {
                  begin("Help me create a reusable workflow.");
                }}
              >
                <Plus />
                New workflow
              </Button>
            )}
          </div>
          <div className={scene === "templates" ? "template-list" : "workflow-list"}>
            {(scene === "workflows"
              ? ["Weekly competitor brief", "Morning overview", "Meeting preparation"]
              : ["Research a topic", "Plan the week", "Prepare for a meeting", "Summarize a page"]
            )
              .filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
              .map((s, i) => (
                <button
                  className="library-row"
                  key={s}
                  onClick={() => {
                    begin(scene === "workflows" ? task : `Help me ${s.toLowerCase()}.`);
                  }}
                >
                  {scene === "templates" ? <Globe size={18} /> : <Workflow size={18} />}
                  <span>
                    <strong>{s}</strong>
                    <small>
                      {scene === "templates"
                        ? "Start with a guided prompt"
                        : i === 0
                          ? "Mondays · 9:00 AM"
                          : "On demand"}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
  return (
    <div className={`revision-two ${theme}`}>
      <div className={`v2-shell ${scene === "run" ? "agent-instance" : ""}`}>
        {scene !== "run" && (
          <aside className={`v2-sidebar ${collapsed ? "collapsed" : ""}`}>
            <header>
              <Cloud size={21} />
              {!collapsed && <strong>Misty</strong>}
              <IconButton label="Toggle sidebar" onClick={() => setCollapsed(!collapsed)}>
                <PanelLeft />
              </IconButton>
            </header>
            <nav aria-label="Agents navigation">
              {nav("New task", "new", SquarePen)}
              {nav("Workflows", "workflows", Workflow)}
              {nav("Templates", "templates", LayoutGrid)}
              {nav("Customize", "customize", Settings2)}
            </nav>
            {!collapsed && (
              <>
                <div className="sidebar-recents">
                  <span>Recents</span>
                  <button onClick={() => go("background")}>Weekly competitor brief</button>
                  <button onClick={() => go("done")}>Design review</button>
                </div>
                <div className="sidebar-foot">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      go("takeover");
                      setPanel(true);
                    }}
                  >
                    <Cloud size={15} />
                    Ask Misty <kbd>⌥ Space</kbd>
                  </Button>
                </div>
              </>
            )}
          </aside>
        )}
        <div className="v2-window">
          <header className="window-tabs">
            {scene === "run" ? (
              <>
                <Cloud size={16} />
                <strong>Misty · Agent window</strong>
                <span className="window-separator" />
                <span>Weekly competitor brief</span>
                <div className="flex-spacer" />
                <Button variant="ghost" size="sm" onClick={() => go("background")}>
                  <ArrowLeft size={14} />
                  Back to my window
                </Button>
              </>
            ) : (
              <>
                <button
                  className={`window-tab ${!live && scene !== "done" ? "active" : ""}`}
                  onClick={() => go("new")}
                >
                  <Cloud size={15} />
                  Agents
                </button>
                <button
                  className={`window-tab ${live ? "active" : ""}`}
                  onClick={() => go("takeover")}
                >
                  <Globe size={15} />
                  Northstar
                </button>
                <IconButton
                  label="New tab"
                  onClick={() => setToast("This is a layout preview of the Misty window.")}
                >
                  <Plus />
                </IconButton>
                <div className="flex-spacer" />
                <IconButton label="Search tasks" onClick={() => go("workflows")}>
                  <Search />
                </IconButton>
              </>
            )}
          </header>
          <main
            className={`v2-canvas ${live ? "working-canvas" : ""} ${live && !paused ? "agent-in-control" : ""}`}
          >
            {(scene === "new" || scene === "background") && station}
            {scene === "questions" && questionsView}
            {live && (
              <>
                <div className="working-address">
                  <ArrowLeft size={15} />
                  <ArrowRight size={15} />
                  <div>
                    <Globe size={13} />
                    northstar.example/changelog
                  </div>
                  {scene === "run" && <span>Agent window</span>}
                </div>
                {browserPage}
                {!paused && !stopped && (
                  <div className="agent-pointer">
                    <MousePointer2 size={24} />
                    <span>Reading changelog</span>
                  </div>
                )}
                {panel ? floating : dock}
              </>
            )}
            {scene === "background" && (
              <aside className="background-task">
                <div>
                  <img src={sky} alt="" />
                  <span>
                    <strong>Weekly competitor brief</strong>
                    <small>Working in a separate Misty window</small>
                  </span>
                  <LoaderCircle size={15} className="spin" />
                </div>
                <p>Reading Northstar’s changelog</p>
                <footer>
                  <Button variant="ghost" size="sm" onClick={() => go("run")}>
                    <ExternalLink size={14} />
                    Open agent window
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      go("run");
                      setPanel(true);
                    }}
                  >
                    View conversation
                  </Button>
                </footer>
              </aside>
            )}
            {scene === "done" && doneView}
            {["workflows", "templates", "customize"].includes(scene) && library}
          </main>
        </div>
      </div>
      {toast && (
        <div role="status" className="preview-toast">
          {toast}
          <IconButton label="Dismiss notice" onClick={() => setToast("")}>
            <X />
          </IconButton>
        </div>
      )}
      <footer className="review-strip">
        <span>
          <strong>Misty · Agents</strong>
          <small>Revision 2 · Sample data</small>
        </span>
        <nav aria-label="Mockup scenes">
          {scenes.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              size="sm"
              aria-pressed={scene === s.id}
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
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
