import type { Block, DocPage } from "../content/types";
import { ArrowIcon } from "./Icons";
import { CodeBlock } from "./CodeBlock";

interface DocPageViewProps {
  page: DocPage;
  previous?: DocPage;
  next?: DocPage;
  onNavigate: (path: string) => void;
}

function renderBlock(block: Block, index: number) {
  switch (block.type) {
    case "paragraph":
      return <p key={index}>{block.text}</p>;
    case "code":
      return <CodeBlock key={index} code={block.code} label={block.label} />;
    case "callout":
      return (
        <aside className={`callout ${block.tone}`} key={index}>
          <span className="callout-icon" aria-hidden="true">
            {block.tone === "danger" || block.tone === "warning" ? "!" : "i"}
          </span>
          <div>
            <strong>{block.title}</strong>
            <p>{block.text}</p>
          </div>
        </aside>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={index} className="content-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </List>
      );
    }
    case "steps":
      return (
        <ol className="steps" key={index}>
          {block.items.map((item, step) => (
            <li key={item.title}>
              <span className="step-number">{step + 1}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
                {item.code && <CodeBlock code={item.code} />}
              </div>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="table-wrap" key={index}>
          <table>
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cellIndex}-${cell}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function DocPageView({
  page,
  previous,
  next,
  onNavigate,
}: DocPageViewProps) {
  return (
    <main className="doc-main" id="main-content">
      <article className="doc-article">
        <div className="page-eyebrow">
          <span>{page.eyebrow}</span>
          {page.badge && <span className="badge">{page.badge}</span>}
        </div>
        <h1>{page.title}</h1>
        <p className="page-description">{page.description}</p>
        {page.command && (
          <div className="command-signature">
            <span>$</span>
            <code>{page.command}</code>
          </div>
        )}

        {page.sections.map((section) => (
          <section id={section.id} key={section.id}>
            <h2>
              <a href={`#${section.id}`}>{section.title}</a>
            </h2>
            {section.blocks.map(renderBlock)}
          </section>
        ))}

        <nav className="page-pagination" aria-label="Previous and next pages">
          {previous ? (
            <button
              type="button"
              className="pagination-link previous"
              onClick={() => onNavigate(previous.path)}
            >
              <span>Previous</span>
              <strong>{previous.title}</strong>
              <ArrowIcon />
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button
              type="button"
              className="pagination-link next"
              onClick={() => onNavigate(next.path)}
            >
              <span>Next</span>
              <strong>{next.title}</strong>
              <ArrowIcon />
            </button>
          ) : (
            <span />
          )}
        </nav>

        <footer className="doc-footer">
          <span>Misty CLI Documentation</span>
          <span>Generated from the v0.1.0 command contract</span>
        </footer>
      </article>

      <aside className="toc" aria-label="On this page">
        <h2>On this page</h2>
        <nav>
          {page.sections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.title}
            </a>
          ))}
        </nav>
      </aside>
    </main>
  );
}
