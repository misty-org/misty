import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Plus,
  X,
  Search,
  Settings,
  Home,
  Globe,
  Folder,
  Bot,
  Layers,
  Bell,
  Monitor,
  Laptop,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  LockKeyhole,
  Star,
  FileText,
  ListTodo,
  MessageSquare,
  BookOpen,
  Library,
  Users,
  Check,
  ArrowUp,
  Paperclip,
  Image as ImageIcon,
  Download,
  ArrowDownToLine,
  HardDrive,
  PanelLeft,
  Calendar,
  Circle,
  CheckCheck,
  Copy,
  Play,
  Pause,
} from "lucide-react";
import { Button } from "@/shared/ui/controls/Button";
import { Avatar, AvatarFallback } from "@/shared/ui/display/Avatar";
import logo from "@/assets/branding/misty-white.png";
import "@fontsource-variable/inter";
import "./promo.css";
import {
  DURATION,
  FPS,
  scenes,
  sceneAt,
  progress as p,
  linear,
  lerp,
  typed,
  clickTimes,
} from "./timeline";

const Icon = ({ icon: Component, size = 18, ...props }: any) => (
  <Component size={size} strokeWidth={1.65} {...props} />
);
const Person = ({ name = "AL" }: { name?: string }) => (
  <Avatar className="person">
    <AvatarFallback>{name}</AvatarFallback>
  </Avatar>
);
const Action = ({ children, bright = false }: any) => (
  <Button variant={bright ? "primary" : "outline"} className="action">
    {children}
  </Button>
);
const Row = ({ icon: I, children, active = false, meta }: any) => (
  <div className={`nav-row ${active ? "selected" : ""}`}>
    {I && <Icon icon={I} />}
    <span>{children}</span>
    {meta && <small>{meta}</small>}
  </div>
);
const Reveal = ({ t, start, children, className = "" }: any) => (
  <div
    className={className}
    style={{
      opacity: p(t, start, 0.36),
      transform: `translateY(${(1 - p(t, start, 0.45)) * 7}px)`,
    }}
  >
    {children}
  </div>
);

function GlobalRail({ section }: { section: string }) {
  return (
    <aside className="global-rail">
      <img src={logo} className="rail-logo" />
      <div className="rail-main">
        {[
          [Home, "home"],
          [Globe, "browser"],
          [Bot, "agents"],
          [Folder, "files"],
          [Layers, "spaces"],
        ].map(([I, key]: any) => (
          <div key={key} className={`rail-icon ${section === key ? "selected" : ""}`}>
            <Icon icon={I} size={20} />
          </div>
        ))}
        <div className="space-tile">W</div>
      </div>
      <div className="rail-bottom">
        {[Search, Bell, Monitor, Settings].map((I, i) => (
          <div className="rail-icon" key={i}>
            <Icon icon={I} />
          </div>
        ))}
        <Person />
      </div>
    </aside>
  );
}
function Tabs({ section = "browser", grouped = true, tab = 0 }: any) {
  const names =
    section === "browser"
      ? ["Launch research", "Content checklist", "Website launch"]
      : section === "files"
        ? ["Website launch", "Files"]
        : section === "agents"
          ? ["Website launch", "Launch checklist"]
          : ["Launch research", "Website launch"];
  return (
    <div className="tabs">
      <div className="window-buttons">
        <i />
        <i />
        <i />
      </div>
      {section === "browser" && grouped && <span className="tab-group">Website launch</span>}
      {names.map((name, i) => (
        <div
          className={`app-tab ${(section === "browser" ? i === tab : i === names.length - 1) ? "active" : ""} ${grouped && section === "browser" ? "group-member" : ""}`}
          key={name}
        >
          <Icon
            icon={
              section === "files" && i === 1
                ? Folder
                : section === "agents" && i === 1
                  ? Bot
                  : i === names.length - 1
                    ? Layers
                    : Globe
            }
            size={14}
          />
          {name}
          <X size={12} />
        </div>
      ))}
      <Plus size={17} className="tab-plus" />
    </div>
  );
}
function Shell({ section = "browser", children, grouped = true, tab = 0 }: any) {
  return (
    <div className="app-shell">
      <GlobalRail section={section} />
      <div className="app-right">
        <Tabs section={section} grouped={grouped} tab={tab} />
        {children}
      </div>
    </div>
  );
}
function Browser({ t = 10, sync = false, restored = false, resume = 0 }: any) {
  const grouped = !sync && t >= 14.1;
  const alt = !sync && t >= 10.4 && t < 12.1;
  const scroll = sync ? 172 + resume : lerp(0, 120, p(t, 9, 0.65));
  return (
    <Shell section="browser" grouped={grouped} tab={alt ? 1 : 0}>
      <div className="addressbar">
        <Icon icon={ArrowLeft} />
        <Icon icon={ArrowRight} />
        <Icon icon={RotateCw} />
        <div className="address">
          <Icon icon={LockKeyhole} size={14} />
          {t >= 7 && t < 8.7
            ? typed("research.example/website-launch", t, 7.3, 1.2)
            : alt
              ? "research.example/content-checklist"
              : "research.example/website-launch"}
        </div>
        <Icon icon={Star} />
        <Icon icon={Download} />
        <Icon icon={MoreHorizontal} />
      </div>
      <div className="webpage">
        <div className="site-nav">
          <strong>Fieldnotes</strong>
          <span>Research</span>
          <span>Projects</span>
          <span>Archive</span>
          <Search size={18} />
          <span className="site-person">AL</span>
        </div>
        <div className="web-scroll">
          <div className="research" style={{ transform: `translateY(-${scroll}px)` }}>
            <div className="article-top">
              <span className="document-label">RESEARCH / WEBSITE LAUNCH</span>
              <h1>{alt ? "Content checklist" : "Planning the website launch"}</h1>
              <p className="article-deck">
                Project scope, content requirements, and the review process.
              </p>
              <div className="article-byline">
                Alex Lee <span>October 2, 2026 · 6 min read</span>
              </div>
            </div>
            <div className="article-grid">
              <article>
                <h2>{alt ? "Before publishing" : "Project scope"}</h2>
                <p>
                  The launch includes a homepage, a product overview, and a getting-started guide.
                  Each page needs a clear owner and a complete content review.
                </p>
                <div className="research-table">
                  <div>
                    <strong>Page</strong>
                    <strong>Owner</strong>
                    <strong>Review</strong>
                  </div>
                  <div>
                    <span>Homepage</span>
                    <span>Alex</span>
                    <span>In progress</span>
                  </div>
                  <div>
                    <span>Product overview</span>
                    <span>Sam</span>
                    <span>Ready</span>
                  </div>
                  <div>
                    <span>Getting started</span>
                    <span>Alex</span>
                    <span>Draft</span>
                  </div>
                </div>
                <h2>Launch requirements</h2>
                <p>
                  Review the final copy, export the approved assets, and check navigation on desktop
                  and mobile.
                </p>
                <div className="quote-line">
                  Keep research, decisions, and deliverables in the project brief.
                </div>
                <h2>Review process</h2>
                <p>
                  Share the draft with the team and record remaining changes before the final
                  review.
                </p>
              </article>
              <aside>
                <strong>On this page</strong>
                <span className="current">Project scope</span>
                <span>Launch requirements</span>
                <span>Review process</span>
                <div className="reference-card">
                  <FileText size={24} />
                  <b>Website launch</b>
                  <span>Project reference</span>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
      {!sync && t >= 12.1 && t < 14.1 && (
        <div className="context-menu" style={{ opacity: p(t, 12.1, 0.15) }}>
          <div>Reload tab</div>
          <div>Duplicate tab</div>
          <hr />
          <div className="selected">
            <Layers size={16} />
            Add to group
            <ChevronRight size={15} />
          </div>
          <div className="submenu">
            <Check size={16} />
            Website launch
          </div>
          <hr />
          <div>Close tab</div>
        </div>
      )}
    </Shell>
  );
}
function SpaceRail({ active = "All", shared = false }: any) {
  return (
    <aside className="space-rail">
      <div className="space-heading">
        <span className="space-avatar">W</span>
        <strong>Website launch</strong>
        <ChevronDown size={16} />
      </div>
      <div className="section-label">Explore</div>
      {[
        [Layers, "All"],
        [MessageSquare, "Chat"],
        [ListTodo, "Planner"],
        [BookOpen, "Journal"],
        [Library, "Library"],
      ].map(([I, label]: any) => (
        <Row key={label} icon={I} active={active === label}>
          {label}
        </Row>
      ))}
      <div className="section-label">Recents</div>
      <Row icon={FileText}>Launch brief</Row>
      <Row icon={ListTodo}>Review homepage</Row>
      <Row icon={Folder}>Reference assets</Row>
      <div className="rail-spacer" />
      <Row icon={Users} meta={shared ? "3" : "1"}>
        Members
      </Row>
      <Row icon={HardDrive}>Usage</Row>
    </aside>
  );
}
const items = [
  ["Launch brief", "Note", "Updated just now", FileText],
  ["Review homepage", "Task", "Due October 8", ListTodo],
  ["Reference assets", "Folder", "4 files", Folder],
  ["Content checklist", "Note", "Updated yesterday", FileText],
  ["Homepage draft", "Drawing", "Updated yesterday", ImageIcon],
];
function Collection({ t }: any) {
  return (
    <>
      <div className="page-toolbar">
        <h2>Website launch</h2>
        <div className="push" />
        <Action>
          <Plus size={16} />
          New
        </Action>
      </div>
      <div className="collection">
        <div className="section-tabs">
          <b>Yours</b>
          <span>Suggested</span>
          <span>Favorites</span>
        </div>
        <div className="collection-search">
          <Search size={17} />
          <span>Search your items</span>
          <div className="push" />
          <Icon icon={MoreHorizontal} />
        </div>
        <div className="table-header">
          <span>Name</span>
          <span>Type</span>
          <span>Updated</span>
        </div>
        {items.map(([name, type, date, I]: any, i) => (
          <div key={name} className={`item-row ${i === 0 && t > 18 ? "selected" : ""}`}>
            <Icon icon={I} />
            <strong>{name}</strong>
            <span>{type}</span>
            <small>{date}</small>
            <Star size={15} />
          </div>
        ))}
      </div>
    </>
  );
}
function Brief({ shared = false, t = 0 }: any) {
  return (
    <>
      <div className="page-toolbar">
        <span>Journal</span>
        <ChevronRight size={15} />
        <span>Notes</span>
        <ChevronRight size={15} />
        <strong>Launch brief</strong>
        <div className="push" />
        {shared && (
          <>
            <Person name="AL" />
            <Person name="SP" />
          </>
        )}
        <Icon icon={MoreHorizontal} />
      </div>
      <div className="doc-wrap">
        <div className="doc-meta">
          <FileText size={22} />
          <span>{shared ? "Shared note" : "Note"}</span>
          <span className="push" />
          <span>Saved</span>
          <Check size={14} />
        </div>
        <h1>Launch brief</h1>
        <p className="doc-summary">Website launch · October 12</p>
        <p>
          Publish the new website with approved copy, final assets, and a clear getting-started
          guide.
        </p>
        <h2>Deliverables</h2>
        <div className="doc-check">
          <Check size={17} />
          Confirm the page structure
        </div>
        <div className="doc-check">
          <span className="checkbox" />
          Review homepage copy
        </div>
        <div className="doc-check">
          <span className="checkbox" />
          Export final website assets
        </div>
        <div className="doc-check">
          <span className="checkbox" />
          Check desktop and mobile layouts
        </div>
        <h2>Review notes</h2>
        <p>
          The homepage draft is ready for review. Sam is checking the product section; Alex is
          preparing the assets.
        </p>
        {shared && (
          <Reveal t={t} start={37.2}>
            <div className="collab-edit">
              <span className="collab-name">Sam Park</span>
              {typed("Product section reviewed. Ready for the final copy pass.", t, 37.2, 1.5)}
              <span className="edit-caret" />
            </div>
          </Reveal>
        )}
        <div className="doc-rule" />
        <div className="doc-foot">
          Updated October 2 <span>Website launch</span>
        </div>
      </div>
    </>
  );
}
function Planner({ assign = false, t = 0 }: any) {
  const done = assign && t >= 40;
  return (
    <>
      <div className="page-toolbar">
        <h2>Planner</h2>
        <div className="push" />
        <Action>
          <Plus size={16} />
          New task
        </Action>
      </div>
      <div className="collection">
        <div className="section-tabs">
          <b>Tasks</b>
          <span>Board</span>
          <span>Calendar</span>
        </div>
        <div className="collection-search">
          <Search size={16} />
          <span>Search tasks</span>
          <div className="push" />
          <span>All statuses</span>
          <ChevronDown size={14} />
        </div>
        <div className="task-header">
          <span>Task</span>
          <span>Status</span>
          <span>Assignee</span>
          <span>Due</span>
        </div>
        {[
          ["Review homepage", "In progress", done ? "Sam Park" : "Alex Lee", "Oct 8"],
          ["Export website assets", "To do", "Alex Lee", "Oct 9"],
          ["Check mobile layouts", "To do", "Sam Park", "Oct 10"],
          ["Confirm page structure", "Done", "Alex Lee", "Oct 2"],
        ].map(([name, status, who, date], i) => (
          <div className={`task-row ${assign && i === 0 ? "selected" : ""}`} key={name}>
            <Icon icon={status === "Done" ? Check : Circle} size={16} />
            <strong>{name}</strong>
            <span>{status}</span>
            <span className="assignee">
              <Person name={who === "Sam Park" ? "SP" : "AL"} />
              {who}
            </span>
            <small>{date}</small>
          </div>
        ))}
        {assign && t >= 39.3 && t < 40 && (
          <div className="assignee-menu">
            <Search size={16} />
            <span>Assign to…</span>
            <div>
              <Person name="AL" />
              Alex Lee
            </div>
            <div className="selected">
              <Person name="SP" />
              Sam Park
              <Check size={16} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
function Artwork({ small = false }: any) {
  return (
    <svg
      viewBox="0 0 560 330"
      className={small ? "artwork small" : "artwork"}
      aria-label="Homepage layout"
    >
      <rect width="560" height="330" fill="#ececec" />
      <rect x="30" y="25" width="32" height="12" rx="3" fill="#242424" />
      <rect x="347" y="28" width="41" height="5" rx="2" fill="#8c8c8c" />
      <rect x="404" y="28" width="41" height="5" rx="2" fill="#8c8c8c" />
      <rect x="465" y="23" width="65" height="15" rx="3" fill="#242424" />
      <text
        x="34"
        y="117"
        fontFamily="Inter, sans-serif"
        fontSize="29"
        fontWeight="600"
        fill="#202020"
      >
        Website launch
      </text>
      <text x="35" y="142" fontFamily="Inter, sans-serif" fontSize="11" fill="#656565">
        Research, design, and release notes.
      </text>
      <rect x="35" y="162" width="80" height="25" rx="4" fill="#252525" />
      <text x="48" y="178" fontFamily="Inter, sans-serif" fontSize="9" fill="#fff">
        View project
      </text>
      <rect x="326" y="77" width="204" height="130" rx="7" fill="#d4d4d4" />
      <rect x="346" y="99" width="162" height="88" rx="4" fill="#fafafa" />
      <rect x="357" y="109" width="41" height="5" rx="2" fill="#555" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={35 + i * 169} y="234" width="153" height="56" rx="4" fill="#dedede" />
          <rect x={45 + i * 169} y="302" width="66" height="4" rx="2" fill="#aaa" />
        </g>
      ))}
    </svg>
  );
}
function LibraryView() {
  return (
    <>
      <div className="page-toolbar">
        <h2>Library</h2>
        <div className="push" />
        <Action>
          <ArrowUp size={15} />
          Upload
        </Action>
      </div>
      <div className="collection">
        <div className="section-tabs">
          <b>All files</b>
          <span>Collections</span>
          <span>Favorites</span>
        </div>
        <div className="collection-search">
          <Search size={17} />
          <span>Search files</span>
        </div>
        <div className="library-grid">
          <div className="library-file">
            <Artwork small />
            <strong>homepage-layout.png</strong>
            <span>PNG · 18.4 MB</span>
          </div>
          <div className="library-file">
            <div className="file-cover">
              <FileText size={52} />
              <b>Launch brief</b>
            </div>
            <strong>launch-brief.pdf</strong>
            <span>PDF · 128 KB</span>
          </div>
          <div className="library-file">
            <div className="file-cover">
              <Folder size={54} />
              <b>Reference assets</b>
            </div>
            <strong>Reference assets</strong>
            <span>4 files</span>
          </div>
        </div>
      </div>
    </>
  );
}
function Chat({ t }: any) {
  return (
    <>
      <div className="page-toolbar">
        <h2>Everyone</h2>
        <ChevronDown size={16} />
        <div className="push" />
        <Users size={18} />
        <span>3</span>
        <Search size={18} />
      </div>
      <div className="chat-body">
        <div className="chat-date">October 2</div>
        <ChatLine
          who="Sam Park"
          initials="SP"
          time="10:24"
          text="The homepage draft is ready. I added the layout to the Library."
        />
        <ChatLine
          who="Alex Lee"
          initials="AL"
          time="10:25"
          text="Thanks. I’ll review the copy and prepare the final assets."
        />
        <Reveal t={t} start={31.6}>
          <ChatLine
            who="Sam Park"
            initials="SP"
            time="10:26"
            text="I can take the product section. The review notes are in the launch brief."
          />
          <div className="attachment">
            <FileText size={23} />
            <div>
              <strong>Launch brief</strong>
              <span>Shared note · Website launch</span>
            </div>
            <ChevronRight size={17} />
          </div>
        </Reveal>
        <Reveal t={t} start={33.3}>
          <ChatLine
            who="Alex Lee"
            initials="AL"
            time="10:27"
            text="I’ll assign the homepage review to you. Let’s use the same brief for feedback."
          />
        </Reveal>
      </div>
      <div className="composer">
        <span>Message Everyone</span>
        <div>
          <Plus size={19} />
          <Paperclip size={18} />
          <div className="push" />
          <ArrowUp size={18} />
        </div>
      </div>
    </>
  );
}
function ChatLine({ who, initials, time, text }: any) {
  return (
    <div className="chat-line">
      <Person name={initials} />
      <div>
        <div className="message-heading">
          <strong>{who}</strong>
          <small>{time}</small>
        </div>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Spaces({ t, shared = false }: any) {
  const mode = shared
    ? t < 36.2
      ? "chat"
      : t < 39
        ? "brief"
        : "planner"
    : t < 18.5
      ? "all"
      : t < 22.5
        ? "brief"
        : t < 26.2
          ? "planner"
          : "library";
  return (
    <Shell section="spaces">
      <div className="workspace">
        <SpaceRail
          active={
            { all: "All", chat: "Chat", brief: "Journal", planner: "Planner", library: "Library" }[
              mode
            ]
          }
          shared={shared}
        />
        <main className="workspace-main">
          {mode === "all" ? (
            <Collection t={t} />
          ) : mode === "brief" ? (
            <Brief t={t} shared={shared} />
          ) : mode === "planner" ? (
            <Planner t={t} assign={shared} />
          ) : mode === "library" ? (
            <LibraryView />
          ) : (
            <Chat t={t} />
          )}
        </main>
      </div>
    </Shell>
  );
}
function Files({ t }: any) {
  const remote = t >= 43.7;
  const preview = t >= 46;
  const transfer = t >= 48.3;
  const fraction = linear(t, 48.7, 3.2);
  return (
    <Shell section="files">
      <div className="addressbar">
        <ArrowLeft size={18} />
        <ArrowRight size={18} />
        <ArrowUp size={18} />
        <div className="file-breadcrumb">
          <Icon icon={remote ? Monitor : HardDrive} />
          <span>{remote ? "Studio Mac" : "This computer"}</span>
          <ChevronRight size={14} />
          <span>Website launch</span>
        </div>
        <Search size={18} />
        <MoreHorizontal size={18} />
      </div>
      <div className="workspace files-workspace">
        <aside className="space-rail files-rail">
          <div className="section-label">Favorites</div>
          <Row icon={Home}>Home</Row>
          <Row icon={Download}>Downloads</Row>
          <Row icon={FileText}>Documents</Row>
          <div className="section-label">Locations</div>
          <Row icon={HardDrive} active={!remote}>
            This computer
          </Row>
          <div className="section-label">Connected devices</div>
          <Row icon={Monitor} active={remote}>
            Studio Mac
          </Row>
          <Row icon={Laptop}>Work laptop</Row>
          <div className="rail-spacer" />
          <Row icon={ArrowDownToLine}>Transfers</Row>
        </aside>
        <main className="files-main">
          <div className="files-heading">
            <h2>Website launch</h2>
            <span>{remote ? "Studio Mac · Local network" : "Documents"}</span>
            <div className="push" />
            <Icon icon={MoreHorizontal} />
          </div>
          <div className="files-columns">
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
          </div>
          {[
            ["homepage-layout.png", "18.4 MB", ImageIcon],
            ["launch-brief.pdf", "128 KB", FileText],
            ["brand-assets.zip", "8.2 MB", Folder],
            ["content-checklist.md", "4 KB", FileText],
            ["Reference assets", "4 items", Folder],
          ].map(([name, size, I]: any, i) => (
            <div className={`file-row ${preview && i === 0 ? "selected" : ""}`} key={name}>
              <Icon icon={I} />
              <strong>{name}</strong>
              <span>{size}</span>
              <small>Today</small>
            </div>
          ))}
          <div className="file-bottom">5 items</div>
        </main>
        {preview && (
          <div className="preview-panel" style={{ opacity: p(t, 46, 0.25) }}>
            <div className="preview-label">
              Preview
              <PanelLeft size={16} />
            </div>
            <Artwork />
            <h3>homepage-layout.png</h3>
            <dl>
              <dt>Kind</dt>
              <dd>PNG image</dd>
              <dt>Size</dt>
              <dd>18.4 MB</dd>
              <dt>Location</dt>
              <dd>Studio Mac</dd>
            </dl>
            <Action>
              <Copy size={15} />
              Copy to this computer
            </Action>
          </div>
        )}
      </div>
      {transfer && (
        <div className="transfer-toast" style={{ opacity: p(t, 48.3, 0.3) }}>
          <div className="transfer-head">
            <Icon icon={fraction >= 1 ? Check : ArrowDownToLine} />
            <strong>{fraction >= 1 ? "Transfer complete" : "Copying homepage-layout.png"}</strong>
            <span>{Math.round(fraction * 100)}%</span>
          </div>
          <div className="transfer-track">
            <div style={{ width: `${fraction * 100}%` }} />
          </div>
          <div className="transfer-detail">
            <span>Studio Mac → Work laptop</span>
            <span>
              {fraction >= 1 ? "18.4 MB copied" : `${(fraction * 18.4).toFixed(1)} / 18.4 MB`}
            </span>
          </div>
        </div>
      )}
    </Shell>
  );
}
function Agents({ t }: any) {
  const sent = t >= 58.3;
  const answer = t >= 60;
  return (
    <Shell section="agents">
      <div className="workspace">
        <aside className="space-rail">
          <div className="space-heading">
            <Bot size={22} />
            <strong>Agents</strong>
          </div>
          <Row icon={Bot} active>
            All agents
          </Row>
          <Row icon={Calendar}>Scheduled</Row>
          <div className="section-label">Agents</div>
          <Row icon={Bot}>Project assistant</Row>
          <div className="section-label">Recent tasks</div>
          <Row icon={ListTodo} active>
            Launch checklist
          </Row>
        </aside>
        <main className="workspace-main">
          <div className="page-toolbar">
            <Icon icon={Bot} />
            <h2>Launch checklist</h2>
            <div className="push" />
            <span>Project assistant</span>
            <MoreHorizontal size={18} />
          </div>
          <div className="agent-thread">
            <div className="agent-context">
              <Layers size={17} />
              Website launch
              <ChevronRight size={14} />
              <FileText size={17} />
              Launch brief
            </div>
            {sent && (
              <Reveal t={t} start={58.3}>
                <ChatLine
                  who="Alex Lee"
                  initials="AL"
                  time="10:31"
                  text="Turn the launch brief into a checklist for the website release."
                />
              </Reveal>
            )}
            {sent && (
              <Reveal t={t} start={58.8}>
                <div className="agent-step">
                  <FileText size={17} />
                  <span>Read launch brief</span>
                  <Check size={16} />
                </div>
              </Reveal>
            )}
            {answer && (
              <Reveal t={t} start={60}>
                <div className="agent-answer">
                  <div className="agent-answer-heading">
                    <Bot size={21} />
                    <strong>Project assistant</strong>
                  </div>
                  <h2>Website launch checklist</h2>
                  {[
                    "Review homepage and product copy",
                    "Export approved website assets",
                    "Check navigation and links",
                    "Review desktop and mobile layouts",
                    "Complete the final team review",
                  ].map((v, i) => (
                    <Reveal t={t} start={60.3 + i * 0.36} key={v}>
                      <div className="answer-check">
                        <span className="checkbox" />
                        {v}
                      </div>
                    </Reveal>
                  ))}
                  <div className="answer-source">
                    <FileText size={14} />
                    Source: Launch brief
                  </div>
                </div>
              </Reveal>
            )}
          </div>
          <div className="composer agent-composer">
            <span className={!sent ? "typed-prompt" : ""}>
              {sent
                ? "Reply to Project assistant"
                : typed(
                    "Turn the launch brief into a checklist for the website release.",
                    t,
                    55.5,
                    2.6,
                  )}
            </span>
            <div>
              <Paperclip size={18} />
              <span className="attached-file">
                <FileText size={13} />
                Launch brief
              </span>
              <div className="push" />
              <span className="send-button">
                <ArrowUp size={18} />
              </span>
            </div>
          </div>
        </main>
      </div>
    </Shell>
  );
}
function Sync({ t }: any) {
  const local = t - 66;
  const moving = local >= 5 && local < 8.3;
  const restored = local >= 11.2;
  const second = local >= 8.3;
  return (
    <div className="sync-scene">
      <div className="device-heading">
        <Icon icon={second ? Laptop : Monitor} size={26} />
        <strong>{second ? "Work laptop" : "Studio Mac"}</strong>
        <span>{restored ? "Workspace opened" : moving ? "Workspace saved" : ""}</span>
      </div>
      <div
        className="sync-window"
        style={{
          opacity: moving ? 1 - p(local, 5.8, 0.9) : second ? p(local, 8.3, 0.65) : 1,
          transform: `translateX(${moving ? -80 * p(local, 5.8, 0.9) : second ? 80 * (1 - p(local, 8.3, 0.65)) : 0}px) scale(${moving ? 1 - 0.07 * p(local, 5.8, 0.9) : 1})`,
        }}
      >
        <Browser t={16} sync restored={restored} resume={54 * p(local, 15.2, 0.75)} />
        {local >= 8.9 && local < 10.5 && (
          <div className="sync-popup">
            <div className="device-row">
              <Monitor size={21} />
              <div>
                <strong>Studio Mac</strong>
                <span>Online</span>
              </div>
              <Button variant="outline">Open</Button>
            </div>
            <div className="device-row">
              <Laptop size={21} />
              <div>
                <strong>Work laptop</strong>
                <span>This device</span>
              </div>
              <Button variant="outline" disabled>
                Open
              </Button>
            </div>
            <div className="manage-sync">Manage sync</div>
          </div>
        )}
        {local >= 10.5 && !restored && (
          <div className="restore-notice">
            <RotateCw size={17} style={{ transform: `rotate(${local * 140}deg)` }} />
            Opening Studio Mac’s workspace…
          </div>
        )}
        {restored && local < 13.8 && (
          <div className="restore-notice">
            <CheckCheck size={19} />
            Workspace restored
          </div>
        )}
      </div>
      {moving && (
        <div
          className="handoff-bridge"
          style={{ opacity: p(local, 6.3, 0.3) * (1 - p(local, 7.9, 0.3)) }}
        >
          <Monitor size={58} />
          <div className="handoff-line">
            <i style={{ transform: `scaleX(${p(local, 6.5, 1)})` }} />
          </div>
          <Laptop size={58} />
        </div>
      )}
      <div className="sync-detail" style={{ opacity: restored ? p(local, 11, 0.5) : 0 }}>
        <span>
          <Check size={17} />
          Tabs
        </span>
        <span>
          <Check size={17} />
          Page position
        </span>
        <span>
          <Check size={17} />
          Supported website sign-ins
        </span>
      </div>
    </div>
  );
}
const cursorKeys: [number, number, number][] = [
  [7, 790, 450],
  [8.5, 747, 62],
  [8.7, 747, 62],
  [9.5, 800, 360],
  [10.25, 352, 23],
  [10.4, 352, 23],
  [11.8, 320, 20],
  [12.1, 320, 20],
  [12.8, 405, 172],
  [13.9, 601, 161],
  [14.1, 601, 161],
  [15, 780, 430],
  [17, 580, 340],
  [18.1, 524, 283],
  [18.2, 524, 283],
  [19, 620, 364],
  [22.3, 166, 238],
  [22.5, 166, 238],
  [25, 730, 338],
  [26.1, 166, 313],
  [26.2, 166, 313],
  [29, 720, 390],
  [30, 625, 465],
  [31.5, 172, 165],
  [31.6, 172, 165],
  [34.8, 624, 373],
  [36.1, 567, 416],
  [36.2, 567, 416],
  [38.7, 636, 450],
  [39.1, 1264, 295],
  [39.3, 1264, 295],
  [40, 1264, 349],
  [41, 798, 462],
  [42, 682, 370],
  [43.5, 163, 368],
  [43.7, 163, 368],
  [45.8, 501, 206],
  [46, 501, 206],
  [47.8, 1234, 483],
  [48.3, 1234, 483],
  [51, 741, 467],
  [54, 678, 400],
  [55.4, 626, 588],
  [55.5, 626, 588],
  [57.8, 1373, 659],
  [58.3, 1373, 659],
  [60, 911, 410],
  [65, 998, 530],
  [66, 783, 437],
  [68, 30, 596],
  [70.1, 380, 546],
  [70.2, 380, 546],
  [72, 800, 490],
  [74.8, 231, 541],
  [75.4, 338, 496],
  [75.5, 338, 496],
  [78, 807, 400],
  [81.1, 683, 472],
  [81.2, 683, 472],
  [84, 853, 480],
];
function Cursor({ t, scale = 1.16, zoom = 1 }: any) {
  if (t < 7 || t >= 84 || (t > 71 && t < 74.8)) return null;
  let k = cursorKeys.findIndex((v) => v[0] > t);
  if (k < 0) k = cursorKeys.length - 1;
  const a = cursorKeys[Math.max(0, k - 1)],
    b = cursorKeys[k],
    q = p(t, a[0], Math.max(0.1, b[0] - a[0]));
  const x = lerp(a[1], b[1], q),
    y = lerp(a[2], b[2], q);
  const recent = clickTimes.filter((c) => t >= c && t < c + 0.4).at(-1);
  const ring = recent === undefined ? 0 : linear(t, recent, 0.4);
  return (
    <div
      className="film-cursor"
      style={{
        left: 125 + 835 + (x * scale - 835) * zoom,
        top: (t >= 66 ? 216 : 200) + 408.5 + (y * scale - 408.5) * zoom,
      }}
    >
      {recent !== undefined && (
        <div
          className="click-ring"
          style={{ opacity: 1 - ring, transform: `scale(${0.4 + ring})` }}
        />
      )}
      <svg width="24" height="31" viewBox="0 0 24 31">
        <path
          d="M2 2 L2 24 L8 19 L13 29 L17 27 L12 17 L21 17 Z"
          fill="#f4f4f4"
          stroke="#141414"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
function Film({ time }: { time: number }) {
  const scene = sceneAt(time);
  const intro = scene.id === "intro";
  const close = scene.id === "close";
  const brand = close || (intro && time < 2.8);
  const appOpacity = intro ? p(time, 2.8, 0.65) : close ? 0 : 1;
  const zoom =
    scene.id === "spaces"
      ? 1 + 0.065 * p(time, 19, 2) * (1 - p(time, 28.8, 1))
      : scene.id === "agents"
        ? 1 + 0.065 * p(time, 59, 2) * (1 - p(time, 64.8, 1))
        : 1;
  const enter = intro ? p(time, 2.8, 0.9) : p(time, scene.start, 0.35);
  return (
    <div className="film" data-scene={scene.id} data-time={time.toFixed(3)}>
      {brand && (
        <div
          className="brand-frame"
          style={{
            opacity: close
              ? p(time, 84, 0.6) * (1 - p(time, 89.5, 0.5))
              : p(time, 0, 0.6) * (1 - p(time, 2.2, 0.5)),
          }}
        >
          <div className="brand-lockup">
            <img src={logo} />
            <span>Misty</span>
          </div>
          <p>{close ? "Try the beta" : "Browser · Spaces · Files · Agents · Sync"}</p>
        </div>
      )}
      {!close && (
        <>
          <header className="film-header" style={{ opacity: intro ? p(time, 2.8, 0.4) : enter }}>
            <div>
              <h1>{scene.title}</h1>
              {scene.subtitle && <p>{scene.subtitle}</p>}
            </div>
            <img src={logo} />
          </header>
          <div
            className={`screen-stage ${scene.id === "sync" ? "sync-stage" : ""}`}
            style={{
              opacity: appOpacity,
              transform: `translateY(${intro ? 22 * (1 - enter) : 0}px) scale(${zoom})`,
            }}
          >
            {scene.id === "sync" ? (
              <Sync t={time} />
            ) : (
              <div className="screen-scale">
                {intro || scene.id === "browser" ? (
                  <Browser t={time} />
                ) : scene.id === "spaces" || scene.id === "shared" ? (
                  <Spaces t={time} shared={scene.id === "shared"} />
                ) : scene.id === "files" ? (
                  <Files t={time} />
                ) : (
                  <Agents t={time} />
                )}
              </div>
            )}
          </div>
          <Cursor t={time} zoom={zoom} />
        </>
      )}
    </div>
  );
}
function Player() {
  const [time, setTime] = useState(Number(new URLSearchParams(location.search).get("t") || 0));
  const [playing, setPlaying] = useState(false);
  const [fit, setFit] = useState(Math.min(innerWidth / 1920, (innerHeight - 86) / 1080));
  const render = new URLSearchParams(location.search).has("render");
  useEffect(() => {
    (window as any).renderFrame = (frame: number) => {
      flushSync(() => setTime(Math.min(DURATION - 1 / FPS, Math.max(0, frame / FPS))));
    };
    (window as any).promoReady = true;
    const resize = () => setFit(Math.min(innerWidth / 1920, (innerHeight - 86) / 1080));
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - time * 1000;
    let id = 0;
    const tick = (now: number) => {
      const next = (now - start) / 1000;
      if (next >= DURATION) {
        setTime(DURATION - 1 / FPS);
        setPlaying(false);
        return;
      }
      setTime(next);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  return (
    <>
      <div
        className="preview-viewport"
        style={render ? { width: 1920, height: 1080 } : { width: 1920 * fit, height: 1080 * fit }}
      >
        <div
          style={{
            width: 1920,
            height: 1080,
            transform: render ? "none" : `scale(${fit})`,
            transformOrigin: "top left",
          }}
        >
          <Film time={time} />
        </div>
      </div>
      {!render && (
        <div className="player-controls">
          <button
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (time > 89.9) setTime(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <span>
            {Math.floor(time / 60)}:{String(Math.floor(time % 60)).padStart(2, "0")}
          </span>
          <input
            aria-label="Video timeline"
            type="range"
            min="0"
            max="89.9667"
            step="0.033333"
            value={time}
            onChange={(e) => {
              setPlaying(false);
              setTime(Number(e.target.value));
            }}
          />
          <span>1:30</span>
          <select
            aria-label="Scene"
            value={sceneAt(time).id}
            onChange={(e) => {
              setPlaying(false);
              setTime(scenes.find((s) => s.id === e.target.value)!.start);
            }}
          >
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title === "Misty" ? (s.id === "intro" ? "Introduction" : "Close") : s.title}
              </option>
            ))}
          </select>
          <span className="preview-note">Animation preview · silent</span>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Player />);
