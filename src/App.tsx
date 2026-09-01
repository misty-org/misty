import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Github, Menu, Moon, Search, Sun, X } from "lucide-react";
import { Link, NavLink, Navigate, useLocation, useNavigate } from "react-router";
import { navigation, pageByPath, pages, type ContentBlock, type DocsPage } from "@/content";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Misty docs home">
      <span className="brand-mark" aria-hidden="true" />
      <span>Misty</span>
      <span className="brand-divider" />
      <span className="brand-docs">Docs</span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="sidebar-nav">
      {navigation.map((group) => (
        <div className="nav-group" key={group.label}>
          <p>{group.label}</p>
          {group.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              onClick={onNavigate}
              className={({ isActive }) => cn("nav-link", isActive && "active")}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) =>
    part.startsWith("`") && part.endsWith("`")
      ? <code key={index}>{part.slice(1, -1)}</code>
      : <span key={index}>{part}</span>,
  );
}

function CodeBlock({ code, filename, language }: Extract<ContentBlock, { type: "code" }>) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span>{filename ?? language ?? "Code"}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? <Check /> : <Copy />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre><code data-language={language}>{code}</code></pre>
    </div>
  );
}

function Content({ block }: { block: ContentBlock }) {
  if (block.type === "p") return <p><RichText text={block.text} /></p>;
  if (block.type === "code") return <CodeBlock {...block} />;
  if (block.type === "callout") {
    return <aside className="callout" data-kind={block.kind ?? "note"}><strong>{block.title}</strong><span><RichText text={block.text} /></span></aside>;
  }
  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return <List className="doc-list">{block.items.map((item) => <li key={item}><RichText text={item} /></li>)}</List>;
  }
  if (block.type === "table") {
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}><RichText text={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="path-list">
      {block.items.map((item) => (
        <Link to={item.path} className="path-row" key={item.path}>
          <span><strong>{item.title}</strong><small>{item.description}</small></span>
          <ArrowRight aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

function PageFooter({ page }: { page: DocsPage }) {
  const index = pages.findIndex((item) => item.path === page.path);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index < pages.length - 1 ? pages[index + 1] : undefined;

  return (
    <footer className="page-footer">
      {page.source && (
        <a className="source-link" href={page.source.href}>
          Source: {page.source.label}
          <ExternalLink />
        </a>
      )}
      <div className="page-pagination">
        {previous ? <Link to={previous.path}><ArrowLeft /><span><small>Previous</small>{previous.title}</span></Link> : <span />}
        {next ? <Link to={next.path}><span><small>Next</small>{next.title}</span><ArrowRight /></Link> : <span />}
      </div>
    </footer>
  );
}

function DocumentPage({ page }: { page: DocsPage }) {
  return (
    <article className="doc-article">
      <header className="article-header">
        <p className="breadcrumb">{page.group}</p>
        <h1>{page.title}</h1>
        <p className="lede">{page.description}</p>
      </header>
      {page.sections.map((section) => (
        <section id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          {section.blocks.map((block, index) => <Content block={block} key={index} />)}
        </section>
      ))}
      <PageFooter page={page} />
    </article>
  );
}

function DocumentRoute() {
  const location = useLocation();
  const aliases: Record<string, string> = {
    "/docs": "/",
    "/docs/introduction": "/",
    "/docs/plugins-overview": "/extensions/overview",
    "/docs/building-plugins": "/extensions/build",
  };
  if (aliases[location.pathname]) return <Navigate to={aliases[location.pathname]} replace />;
  const page = pageByPath(location.pathname);
  return page ? <DocumentPage page={page} /> : <Navigate to="/" replace />;
}

function TableOfContents({ page }: { page: DocsPage }) {
  const [active, setActive] = useState(page.sections[0]?.id ?? "");

  useEffect(() => {
    setActive(page.sections[0]?.id ?? "");
    const headings = page.sections.map((section) => document.getElementById(section.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-96px 0px -65% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [page]);

  if (!page.sections.length) return null;
  return (
    <nav className="toc" aria-label="On this page">
      <p>On this page</p>
      {page.sections.map((section) => (
        <a className={active === section.id ? "active" : undefined} href={`#${section.id}`} key={section.id}>{section.title}</a>
      ))}
    </nav>
  );
}

function searchableText(page: DocsPage) {
  return [
    page.title,
    page.description,
    page.group,
    ...(page.keywords ?? []),
    ...page.sections.flatMap((section) => [section.title, JSON.stringify(section.blocks)]),
  ].join(" ").toLowerCase();
}

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pages.slice(0, 8);
    return pages.filter((page) => searchableText(page).includes(normalized)).slice(0, 10);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const choose = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="search-dialog">
        <DialogTitle>Search documentation</DialogTitle>
        <DialogDescription>Find a guide, command, capability, or extension contract.</DialogDescription>
        <div className="search-field"><Search /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands, extensions, servers…" /></div>
        <div className="search-results">
          {results.map((page) => (
            <button type="button" key={page.path} onClick={() => choose(page.path)}>
              <span><strong>{page.title}</strong><small>{page.description}</small></span>
              <span className="result-group">{page.group}</span>
            </button>
          ))}
          {!results.length && <p>No documentation matched “{query}”.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
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

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const page = pageByPath(location.pathname) ?? pages[0];

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
    updateMeta(page);
  }, [location.pathname, page]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  return (
    <div className="site-shell">
      <header className="site-header">
        <Brand />
        <div className="header-actions">
          <button className="search-trigger" type="button" onClick={() => setSearchOpen(true)} aria-label="Search documentation"><Search /><span>Search docs</span><kbd>⌘ K</kbd></button>
          <Button asChild variant="ghost" size="icon"><a href="https://github.com/misty-org" aria-label="Misty on GitHub"><Github /></a></Button>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun /> : <Moon />}</Button>
          <Button className="menu-button" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button>
        </div>
      </header>

      <aside className="left-sidebar"><Sidebar /></aside>
      {mobileOpen && (
        <div className="mobile-drawer">
          <button className="drawer-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
          <aside>
            <div className="drawer-header"><Brand /><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></Button></div>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <main className="main-content"><DocumentRoute /></main>
      <aside className="right-sidebar"><TableOfContents page={page} /></aside>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
