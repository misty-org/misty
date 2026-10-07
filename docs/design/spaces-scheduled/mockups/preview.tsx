import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpenText,
  Notebook,
  MessagesSquare,
  CalendarDays,
  Layers,
  Search,
  Bell,
  Plus,
  ChevronDown,
  ListFilter,
  LayoutGrid,
  List,
  FileText,
  PencilRuler,
  CheckSquare,
  Users,
  Clock3,
  CalendarClock,
  Sun,
  Moon,
  MoreHorizontal,
  Star,
  ArrowLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/shared/ui/controls/Button";
import { IconButton } from "@/shared/ui/controls/IconButton";
import { Input } from "@/shared/ui/controls/Input";
import { Card } from "@/shared/ui/display/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/display/Table";
import "@/styles/styles.css";
import "./preview.css";

const tools = [
  {
    name: "Chat",
    icon: MessagesSquare,
    description: "Conversations, all together",
    meta: "3 conversations",
  },
  {
    name: "Planner",
    icon: CalendarDays,
    description: "Make room for what matters",
    meta: "5 tasks this week",
  },
  {
    name: "Journal",
    icon: Notebook,
    description: "A place for your thoughts",
    meta: "12 notes · 3 drawings",
  },
  {
    name: "Library",
    icon: BookOpenText,
    description: "Keep useful things close",
    meta: "24 files",
  },
];
const recent = [
  {
    title: "September reflections",
    area: "Journal",
    icon: Notebook,
    date: "Today, 2:14 PM",
    star: true,
  },
  {
    title: "Plan the week ahead",
    area: "Planner",
    icon: CheckSquare,
    date: "Today, 11:30 AM",
    star: false,
  },
  {
    title: "Ideas worth keeping",
    area: "Journal",
    icon: FileText,
    date: "Today, 9:42 AM",
    star: true,
  },
  {
    title: "Autumn reading list",
    area: "Library",
    icon: BookOpenText,
    date: "Yesterday",
    star: false,
  },
  { title: "A slower morning", area: "Journal", icon: FileText, date: "Yesterday", star: false },
  { title: "Weekend plans", area: "Chat", icon: MessagesSquare, date: "Sep 28", star: false },
  {
    title: "Home workspace sketch",
    area: "Journal",
    icon: PencilRuler,
    date: "Sep 27",
    star: false,
  },
];
const tasks = [
  { title: "Evening reflection", time: "Today, 8:30 PM · Daily" },
  { title: "Morning overview", time: "Tomorrow, 8:00 AM · Daily" },
  { title: "Weekly planning", time: "Sunday, 5:00 PM · Weekly" },
];
const starters = [
  {
    icon: Sun,
    title: "Morning overview",
    body: "Start the day with your priorities and what’s coming up.",
  },
  { icon: Moon, title: "Evening reflection", body: "Make a little time to reflect on your day." },
  {
    icon: CalendarDays,
    title: "Weekly planning",
    body: "Review the week and choose what to focus on next.",
  },
  {
    icon: BookOpenText,
    title: "Reading reminder",
    body: "Set aside time to return to something in your Library.",
  },
];

function GlyphButton({
  icon: Icon,
  label,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  [key: string]: any;
}) {
  return (
    <IconButton label={label} tooltip={false} {...props}>
      <Icon size={18} strokeWidth={1.7} />
    </IconButton>
  );
}
function Preview() {
  const initial = new URLSearchParams(location.search).get("view") || "spaces";
  const [view, setView] = useState(initial),
    [filter, setFilter] = useState("Recent"),
    [search, setSearch] = useState(""),
    [menu, setMenu] = useState(false),
    [chosen, setChosen] = useState(""),
    [grid, setGrid] = useState(false);
  const scheduled = view === "scheduled";
  const go = (next: string) => {
    setView(next);
    setSearch("");
    setChosen("");
    history.replaceState(null, "", `?view=${next}`);
  };
  const area = tools.find((t) => t.name.toLowerCase() === view);
  const rows = recent.filter(
    (r) =>
      (!area || r.area === area.name) &&
      (!search || r.title.toLowerCase().includes(search.toLowerCase())) &&
      (filter !== "Favorites" || r.star),
  );
  return (
    <div className="preview">
      <aside
        className="sidebar"
        aria-label={scheduled ? "Scheduled navigation" : "Spaces navigation"}
      >
        <header className="sidebar-heading">
          <h1>{scheduled ? "Scheduled" : "Spaces"}</h1>
          <div className="icon-pair">
            {!scheduled && (
              <GlyphButton
                icon={Bell}
                label="Notifications"
                onClick={() => setChosen("You’re all caught up")}
              />
            )}
            <GlyphButton
              icon={Search}
              label="Search sidebar"
              onClick={() =>
                document.querySelector<HTMLInputElement>(".content-search input")?.focus()
              }
            />
          </div>
        </header>
        {scheduled ? (
          <>
            <Button
              className="nav-row new-row"
              variant="ghost"
              justify="start"
              onClick={() => setChosen("New scheduled task")}
            >
              <Plus />
              New task
            </Button>
            <div className="section-label">
              Upcoming
              <GlyphButton
                icon={ListFilter}
                label="Sort upcoming tasks"
                onClick={() => setChosen("Tasks are ordered by next run")}
              />
            </div>
            <div className="task-list">
              {tasks.map((t) => (
                <Button
                  key={t.title}
                  variant="ghost"
                  className="task-row"
                  justify="start"
                  onClick={() => setChosen(t.title)}
                >
                  <span>{t.title}</span>
                  <small>{t.time}</small>
                </Button>
              ))}
            </div>
            <div className="section-label paused-label">Paused</div>
            <Button
              variant="ghost"
              className="task-row"
              justify="start"
              onClick={() => setChosen("Monthly reset · Paused")}
            >
              <span>Monthly reset</span>
              <small>First Sunday of the month</small>
            </Button>
          </>
        ) : (
          <>
            <Button
              className="nav-row new-row"
              variant="ghost"
              justify="start"
              onClick={() => setMenu(!menu)}
            >
              <Plus />
              New item
            </Button>
            <nav aria-label="Space areas">
              <Button
                className="nav-row"
                variant="ghost"
                justify="start"
                aria-pressed={view === "spaces"}
                onClick={() => go("spaces")}
              >
                <Layers />
                All
              </Button>
              {tools.map((t) => (
                <Button
                  key={t.name}
                  className="nav-row"
                  variant="ghost"
                  justify="start"
                  aria-pressed={view === t.name.toLowerCase()}
                  onClick={() => go(t.name.toLowerCase())}
                >
                  <t.icon />
                  {t.name}
                </Button>
              ))}
            </nav>
            <div className="section-label">Recents</div>
            <div className="recent-nav">
              {recent.slice(0, 4).map((r) => (
                <Button
                  key={r.title}
                  className="nav-row"
                  variant="ghost"
                  justify="start"
                  onClick={() => {
                    go(r.area.toLowerCase());
                    setChosen(r.title);
                  }}
                >
                  <r.icon />
                  <span>{r.title}</span>
                </Button>
              ))}
            </div>
            <div className="section-label spaces-label">
              Your spaces
              <GlyphButton
                icon={Plus}
                label="Create space"
                onClick={() => setChosen("Create a space")}
              />
            </div>
            <Button
              className="nav-row space-row"
              variant="ghost"
              justify="start"
              aria-pressed
              onClick={() => go("spaces")}
            >
              <span className="space-initial">P</span>Personal
            </Button>
            <Button
              className="nav-row space-row"
              variant="ghost"
              justify="start"
              onClick={() => setChosen("Studio space")}
            >
              <span className="space-initial">S</span>Studio
            </Button>
          </>
        )}
        <footer className="sidebar-footer">
          {scheduled ? (
            <Button
              className="nav-row"
              variant="ghost"
              justify="start"
              onClick={() => go("spaces")}
            >
              <Layers />
              Spaces
            </Button>
          ) : (
            <>
              <Button
                className="nav-row"
                variant="ghost"
                justify="start"
                onClick={() => go("scheduled")}
              >
                <CalendarClock />
                Scheduled
              </Button>
              <Button
                className="nav-row"
                variant="ghost"
                justify="start"
                onClick={() => setChosen("Personal space · Only you")}
              >
                <Users />
                Members
              </Button>
            </>
          )}
        </footer>
      </aside>
      <main className={scheduled ? "main scheduled-main" : "main"}>
        {scheduled ? (
          <section className="scheduled-start">
            <Clock3 className="hero-clock" size={48} strokeWidth={1.25} />
            <h2>Make time for what matters</h2>
            <p>Let Misty take care of the things you do regularly.</p>
            <div className="starter-grid">
              {starters.map((s) => (
                <Button
                  key={s.title}
                  variant="outline"
                  size="none"
                  className="starter"
                  onClick={() => setChosen(s.title)}
                >
                  <s.icon size={25} strokeWidth={1.5} />
                  <span>
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </span>
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="custom-task"
              onClick={() => setChosen("New scheduled task")}
            >
              <Plus />
              Create your own task
            </Button>
          </section>
        ) : (
          <>
            <header className="content-heading">
              <h2>{area?.name || "All"}</h2>
              <div className="header-actions">
                <label className="content-search">
                  <Search size={17} />
                  <Input
                    variant="bare"
                    placeholder={area ? `Search ${area.name.toLowerCase()}` : "Search this space"}
                    aria-label="Search items"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="new-wrap">
                  <Button variant="primary" className="new-button" onClick={() => setMenu(!menu)}>
                    {area?.name === "Journal" ? "New note" : "New"}
                    <ChevronDown size={15} />
                  </Button>
                  {menu && (
                    <div className="creation-menu">
                      {tools.map((t) => (
                        <Button
                          key={t.name}
                          variant="ghost"
                          justify="start"
                          onClick={() => {
                            setChosen(
                              `New ${t.name === "Chat" ? "conversation" : t.name === "Planner" ? "task" : t.name === "Journal" ? "note" : "file"}`,
                            );
                            setMenu(false);
                          }}
                        >
                          <t.icon />
                          {t.name === "Chat"
                            ? "Conversation"
                            : t.name === "Planner"
                              ? "Task"
                              : t.name === "Journal"
                                ? "Note"
                                : "Upload file"}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </header>
            <div className="filter-bar">
              <div className="filters">
                {(area?.name === "Journal"
                  ? ["Recent", "Favorites", "Notes", "Drawings"]
                  : ["Recent", "Favorites"]
                ).map((f) => (
                  <Button
                    key={f}
                    variant="ghost"
                    className="filter-button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </Button>
                ))}
              </div>
              <div className="view-actions">
                <GlyphButton
                  icon={ListFilter}
                  label="Sort by last activity"
                  onClick={() => setChosen("Sorted by last activity")}
                />
                <span className="toolbar-divider" />
                <GlyphButton
                  icon={LayoutGrid}
                  label="Grid view"
                  aria-pressed={grid}
                  onClick={() => setGrid(true)}
                />
                <GlyphButton
                  icon={List}
                  label="List view"
                  aria-pressed={!grid}
                  onClick={() => setGrid(false)}
                />
              </div>
            </div>
            {!area && (
              <section className="areas">
                <h3>In this space</h3>
                <div className="area-grid">
                  {tools.map((t) => (
                    <Card key={t.name} className="area-card">
                      <Button
                        variant="ghost"
                        size="none"
                        className="area-card-link"
                        onClick={() => go(t.name.toLowerCase())}
                      >
                        <t.icon size={23} strokeWidth={1.5} />
                        <strong>{t.name}</strong>
                        <span>{t.meta}</span>
                      </Button>
                    </Card>
                  ))}
                </div>
              </section>
            )}
            {area?.name === "Journal" && (
              <div className="journal-description">
                Notes, reflections, and sketches. A little room to think.
              </div>
            )}
            <section className={`items-section ${area ? "area-items" : ""}`} aria-label="Items">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>{area ? "Type" : "Area"}</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .filter((r) => filter !== "Drawings" || r.icon === PencilRuler)
                    .filter((r) => filter !== "Notes" || r.icon !== PencilRuler)
                    .map((r) => (
                      <TableRow key={r.title}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="none"
                            className="item-button"
                            onClick={() => setChosen(r.title)}
                          >
                            <span className="file-icon">
                              <r.icon size={20} strokeWidth={1.5} />
                            </span>
                            {r.title}
                            {r.star && <Star className="favorite-star" size={13} />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          {area ? (r.icon === PencilRuler ? "Drawing" : "Note") : r.area}
                        </TableCell>
                        <TableCell>{r.date}</TableCell>
                        <TableCell>
                          <GlyphButton
                            icon={MoreHorizontal}
                            label={`More about ${r.title}`}
                            onClick={() => setChosen(r.title)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {!rows.length && <p className="no-results">No items match your search.</p>}
            </section>
            <p className="space-summary">
              {area ? `${rows.length} items` : "Personal space · Only you"}
            </p>
          </>
        )}
        {grid && (
          <div className="preview-notice">
            List layout shown in this screenshot concept.
            <Button variant="ghost" size="sm" onClick={() => setGrid(false)}>
              Back to list
            </Button>
          </div>
        )}
        {chosen && (
          <div className="preview-notice" role="status">
            <span>
              {chosen}
              <small>Layout preview · sample content</small>
            </span>
            <GlyphButton icon={ArrowLeft} label="Back to preview" onClick={() => setChosen("")} />
          </div>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
