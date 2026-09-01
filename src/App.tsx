import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Blocks, BookOpen, Check, ChevronDown, Copy,
  ExternalLink, FileText, Github, Search, ServerCog, Sparkles, SquareTerminal,
  ThumbsDown, ThumbsUp, X, type LucideIcon,
} from "lucide-react";
import { Link, NavLink, Navigate, useLocation, useNavigate } from "react-router";
import { navigation, pageByPath, pages, type ContentBlock, type DocsPage } from "@/content";
import { SiteFooter } from "@/components/docs/site-footer";
import { WebsiteNavbar } from "@/components/docs/website-navbar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const location = useLocation();
  const currentGroup = pageByPath(location.pathname)?.group;
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("misty-docs-nav-groups") ?? "[]") as string[];
      return new Set(saved.length ? saved : (["Overview", currentGroup].filter(Boolean) as string[]));
    } catch {
      return new Set(["Overview", currentGroup].filter(Boolean) as string[]);
    }
  });

  useEffect(() => {
    if (!currentGroup) return;
    setOpenGroups((groups) => {
      if (groups.has(currentGroup)) return groups;
      const next = new Set(groups).add(currentGroup);
      try { window.localStorage.setItem("misty-docs-nav-groups", JSON.stringify([...next])); } catch { /* Optional preference. */ }
      return next;
    });
  }, [currentGroup]);

  const toggleGroup = (label: string) => {
    setOpenGroups((groups) => {
      const next = new Set(groups);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try { window.localStorage.setItem("misty-docs-nav-groups", JSON.stringify([...next])); } catch { /* Optional preference. */ }
      return next;
    });
  };

  return (
    <nav aria-label="Documentation" className="sidebar-nav">
      <button className="sidebar-search" type="button" onClick={onSearch}>
        <Search aria-hidden="true" /><span>Search docs</span><kbd>⌘ K</kbd>
      </button>
      {navigation.map((group) => {
        const open = openGroups.has(group.label);
        return (
          <div className="nav-group" data-open={open || undefined} key={group.label}>
            <button className="nav-group-trigger" type="button" aria-expanded={open} onClick={() => toggleGroup(group.label)}>
              <span>{group.label}</span><ChevronDown aria-hidden="true" />
            </button>
            <div className="nav-group-links" hidden={!open}>
              {group.items.map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === "/"} onClick={onNavigate} className={({ isActive }) => cn("nav-link", isActive && "active")}>{item.label}</NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>);
}

function normalizeLanguage(language?: string): Language {
  const aliases: Record<string, Language> = { shell: "bash", sh: "bash", text: "markup", http: "markup", ts: "typescript" };
  return aliases[language ?? ""] ?? (language as Language | undefined) ?? "markup";
}

function CodeBlock({ code, filename, language, className }: Extract<ContentBlock, { type: "code" }> & { className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={cn("code-block", className)}>
      <div className="code-header">
        <span><FileText aria-hidden="true" />{filename ?? language ?? "Code"}</span>
        <button type="button" onClick={copy} aria-label="Copy code">{copied ? <Check /> : <Copy />}<span>{copied ? "Copied" : "Copy"}</span></button>
      </div>
      <Highlight theme={themes.vsDark} code={code.trimEnd()} language={normalizeLanguage(language)}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre>{tokens.map((line, index) => {
            const lineProps = getLineProps({ line });
            return <div key={index} className={cn("code-line", lineProps.className)} style={lineProps.style}>{line.map((token, tokenIndex) => {
              const tokenProps = getTokenProps({ token });
              return <span key={tokenIndex} className={tokenProps.className} style={tokenProps.style}>{tokenProps.children}</span>;
            })}</div>;
          })}</pre>
        )}
      </Highlight>
    </div>
  );
}

function Content({ block }: { block: ContentBlock }) {
  if (block.type === "p") return <p><RichText text={block.text} /></p>;
  if (block.type === "code") return <CodeBlock {...block} />;
  if (block.type === "callout") return <aside className="callout" data-kind={block.kind ?? "note"}><strong>{block.title}</strong><span><RichText text={block.text} /></span></aside>;
  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return <List className="doc-list">{block.items.map((item) => <li key={item}><RichText text={item} /></li>)}</List>;
  }
  if (block.type === "table") return <div className="table-wrap"><table><thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}><RichText text={cell} /></td>)}</tr>)}</tbody></table></div>;
  return <div className="path-list">{block.items.map((item) => <Link to={item.path} className="path-row" key={item.path}><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight aria-hidden="true" /></Link>)}</div>;
}

function blockToMarkdown(block: ContentBlock) {
  if (block.type === "p") return block.text;
  if (block.type === "code") return `\`\`\`${block.language ?? ""}\n${block.code}\n\`\`\``;
  if (block.type === "callout") return `> **${block.title}:** ${block.text}`;
  if (block.type === "list") return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${item}`).join("\n");
  if (block.type === "table") return `| ${block.columns.join(" | ")} |\n| ${block.columns.map(() => "---").join(" | ")} |\n${block.rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}`;
  return block.items.map((item) => `- [${item.title}](${item.path}) — ${item.description}`).join("\n");
}

function pageToMarkdown(page: DocsPage) {
  return [`# ${page.title}`, page.description, ...page.sections.flatMap((section) => [`## ${section.title}`, ...section.blocks.map(blockToMarkdown)])].join("\n\n");
}

function ArticleActions({ page }: { page: DocsPage }) {
  const [copied, setCopied] = useState(false);
  const copyPage = async () => {
    await navigator.clipboard.writeText(pageToMarkdown(page));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <div className="article-actions"><button type="button" onClick={copyPage}>{copied ? <Check /> : <Copy />}<span>{copied ? "Copied" : "Copy page"}</span></button>{page.source && <a href={page.source.href} target="_blank" rel="noreferrer"><Github /><span>View source</span></a>}</div>;
}

function RelatedPages({ page }: { page: DocsPage }) {
  const related = pages.filter((item) => item.path !== page.path && item.group === page.group).slice(0, 3);
  if (!related.length) return null;
  return <section className="related-pages" aria-labelledby="related-pages-title"><h2 id="related-pages-title">Related documentation</h2><div>{related.map((item) => <Link to={item.path} key={item.path}><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight aria-hidden="true" /></Link>)}</div></section>;
}

function PageFeedback() {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  return <section className="page-feedback" aria-live="polite">{answer ? <p>Thanks—your feedback helps us improve these docs.</p> : <><p>Was this helpful?</p><div><button type="button" onClick={() => setAnswer("yes")}><ThumbsUp />Yes</button><button type="button" onClick={() => setAnswer("no")}><ThumbsDown />Not yet</button></div></>}</section>;
}

function PageNavigationDock({ page }: { page: DocsPage }) {
  const index = pages.findIndex((item) => item.path === page.path);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index < pages.length - 1 ? pages[index + 1] : undefined;
  if (!previous && !next) return null;
  return <nav className={cn("page-navigation-dock", (!previous || !next) && "single")} aria-label="Documentation pagination">{previous && <Link to={previous.path} className="previous"><ArrowLeft /><span><small>Previous</small>{previous.title}</span></Link>}{next && <Link to={next.path} className="next"><span><small>Next</small>{next.title}</span><ArrowRight /></Link>}</nav>;
}

function DocumentPage({ page }: { page: DocsPage }) {
  return <><article className="doc-article"><header className="article-header"><p className="breadcrumb">{page.group}</p><div className="article-title-row"><h1>{page.title}</h1><ArticleActions page={page} /></div><p className="lede">{page.description}</p></header>{page.sections.map((section) => <section id={section.id} key={section.id}><h2><a href={`#${section.id}`}>{section.title}<span aria-hidden="true">#</span></a></h2>{section.blocks.map((block, index) => <Content block={block} key={index} />)}</section>)}{page.source && <a className="source-link" href={page.source.href} target="_blank" rel="noreferrer">Source: {page.source.label}<ExternalLink /></a>}<RelatedPages page={page} /><PageFeedback /></article><PageNavigationDock page={page} /></>;
}

const landingExamples = [
  { label: "CLI", filename: "Terminal", language: "shell", code: "cargo install --path ~/misty-org/misty-cli --locked --force\nmisty doctor\nmisty desktop dev" },
  { label: "Extension", filename: "Terminal", language: "shell", code: "cd ~/misty-org/misty-extensions\nnpm install\nnpm run dev" },
  { label: "Server", filename: "Terminal", language: "shell", code: "misty env init dev\nmisty server up --detach\nmisty server url" },
] as const;

const landingGroups: Array<{ title: string; description: string; cards: Array<{ title: string; description: string; path: string; icon: LucideIcon; eyebrow: string }> }> = [
  { title: "Build with Misty", description: "Start with the workspace, then choose the surface you want to develop.", cards: [
    { title: "Get started", description: "Prepare the workspace and run your first local development session.", path: "/start", icon: Sparkles, eyebrow: "Start" },
    { title: "CLI", description: "Use one command surface to develop, validate, and release every Misty project.", path: "/cli/overview", icon: SquareTerminal, eyebrow: "Build" },
    { title: "Extensions", description: "Create React panels with carefully scoped access to native Misty capabilities.", path: "/extensions/overview", icon: Blocks, eyebrow: "Extend" },
    { title: "Server", description: "Understand the API boundary, development stack, and self-hosted capabilities.", path: "/server/overview", icon: ServerCog, eyebrow: "Operate" },
  ]},
  { title: "Go deeper", description: "Jump directly into the contracts and workflows used by contributors and operators.", cards: [
    { title: "Command reference", description: "Browse the complete CLI command surface and understand what each family changes.", path: "/cli/commands", icon: BookOpen, eyebrow: "Reference" },
    { title: "Build an extension", description: "Set up the web runtime, preview a panel, and validate a production package.", path: "/extensions/build", icon: Blocks, eyebrow: "Guide" },
    { title: "HTTP API", description: "Learn the canonical routes, authentication model, and client behavior.", path: "/server/http-api", icon: ServerCog, eyebrow: "Reference" },
    { title: "Self-hosting", description: "Run a Misty server with explicit capability discovery and storage choices.", path: "/server/self-hosting", icon: FileText, eyebrow: "Guide" },
  ]},
];

function LandingPage({ page }: { page: DocsPage }) {
  const [example, setExample] = useState<(typeof landingExamples)[number]>(landingExamples[0]);
  return <><div className="landing-page"><section className="landing-hero"><div className="landing-copy"><span className="landing-kicker">Misty developer documentation</span><h1>Build, extend, and operate Misty.</h1><p>{page.description} Set up the workspace, create extensions, and run the services behind the product.</p><div className="landing-actions"><Link className="primary" to="/start">Get started <ArrowRight /></Link><Link to="/extensions/build">Build an extension</Link><Link to="/server/overview">Explore the server</Link></div></div><div className="landing-example"><div className="code-tabs" role="tablist" aria-label="Quick start example">{landingExamples.map((item) => <button key={item.label} role="tab" aria-selected={example.label === item.label} onClick={() => setExample(item)}>{item.label}</button>)}</div><CodeBlock type="code" code={example.code} filename={example.filename} language={example.language} className="hero-code" /></div></section><p className="landing-intro">Misty keeps the desktop app, CLI, extensions, and public server contract in one workspace so contributors can move from an idea to a verified change without stitching together separate toolchains.</p>{landingGroups.map((group) => <section className="landing-group" key={group.title}><div className="landing-group-heading"><h2>{group.title}</h2><p>{group.description}</p></div><div className="landing-card-grid">{group.cards.map(({ icon: Icon, ...card }) => <Link className="landing-card" to={card.path} key={card.path}><div><Icon aria-hidden="true" /><span>{card.eyebrow}</span></div><h3>{card.title}</h3><p>{card.description}</p><ArrowUpRight className="card-arrow" aria-hidden="true" /></Link>)}</div></section>)}</div><PageNavigationDock page={page} /></>;
}

function DocumentRoute() {
  const location = useLocation();
  const aliases: Record<string, string> = { "/docs": "/", "/docs/introduction": "/", "/docs/plugins-overview": "/extensions/overview", "/docs/building-plugins": "/extensions/build" };
  if (aliases[location.pathname]) return <Navigate to={aliases[location.pathname]} replace />;
  const page = pageByPath(location.pathname);
  if (!page) return <Navigate to="/" replace />;
  return page.path === "/" ? <LandingPage page={page} /> : <DocumentPage page={page} />;
}

function TableOfContents({ page }: { page: DocsPage }) {
  const [active, setActive] = useState(page.sections[0]?.id ?? "");
  useEffect(() => {
    setActive(page.sections[0]?.id ?? "");
    const headings = page.sections.map((section) => document.getElementById(section.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-112px 0px -65% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [page]);
  if (!page.sections.length) return null;
  return <nav className="toc" aria-label="On this page"><p>On this page</p>{page.sections.map((section) => <a className={active === section.id ? "active" : undefined} href={`#${section.id}`} key={section.id}>{section.title}</a>)}</nav>;
}

function searchableText(page: DocsPage) {
  return [page.title, page.description, page.group, ...(page.keywords ?? []), ...page.sections.flatMap((section) => [section.title, JSON.stringify(section.blocks)])].join(" ").toLowerCase();
}

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const results = useMemo(() => { const normalized = query.trim().toLowerCase(); return normalized ? pages.filter((page) => searchableText(page).includes(normalized)).slice(0, 10) : pages.slice(0, 8); }, [query]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const choose = (path: string) => { onOpenChange(false); navigate(path); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="search-dialog"><DialogTitle>Search documentation</DialogTitle><DialogDescription>Find a guide, command, capability, or extension contract.</DialogDescription><div className="search-field"><Search /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands, extensions, servers…" /></div><div className="search-results">{results.map((page) => <button type="button" key={page.path} onClick={() => choose(page.path)}><span><strong>{page.title}</strong><small>{page.description}</small></span><span className="result-group">{page.group}</span></button>)}{!results.length && <p>No documentation matched “{query}”.</p>}</div></DialogContent></Dialog>;
}

function updateMeta(page: DocsPage) {
  const configuredOrigin = (import.meta.env.VITE_DOCS_ORIGIN as string | undefined)?.replace(/\/+$/, "");
  const origin = configuredOrigin || "https://docs.mistysys.com";
  const url = `${origin}${page.path === "/" ? "/" : page.path}`;
  const title = page.path === "/" ? "Misty Docs" : `${page.title} · Misty Docs`;
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", page.description);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", url);
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) document.querySelector(selector)?.setAttribute("content", title);
  for (const selector of ['meta[property="og:description"]', 'meta[name="twitter:description"]']) document.querySelector(selector)?.setAttribute("content", page.description);
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", url);
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) document.querySelector(selector)?.setAttribute("content", `${origin}/og.png`);
}

export function App(): ReactNode {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const page = pageByPath(location.pathname) ?? pages[0];
  const isLanding = page.path === "/";
  useEffect(() => { setMobileOpen(false); window.scrollTo({ top: 0 }); updateMeta(page); }, [location.pathname, page]);
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); } };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);
  return <><a className="skip-link" href="#docs-content">Skip to content</a><div className={cn("site-shell", isLanding && "is-landing")}><WebsiteNavbar onOpenSearch={() => setSearchOpen(true)} onOpenDocsMenu={() => setMobileOpen((open) => !open)} docsMenuOpen={mobileOpen} /><aside className="left-sidebar"><Sidebar onSearch={() => setSearchOpen(true)} /></aside>{mobileOpen && <div className="mobile-drawer"><button className="drawer-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /><aside><div className="drawer-header"><span>Documentation</span><button onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button></div><Sidebar onNavigate={() => setMobileOpen(false)} onSearch={() => { setMobileOpen(false); setSearchOpen(true); }} /></aside></div>}<main id="docs-content" className="main-content"><DocumentRoute /></main>{!isLanding && <aside className="right-sidebar"><TableOfContents page={page} /></aside>}<SiteFooter /></div><SearchDialog open={searchOpen} onOpenChange={setSearchOpen} /></>;
}
