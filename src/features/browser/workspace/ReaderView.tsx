import { X } from "lucide-react";
import { Button } from "@/shared/ui";
import type { ReaderArticle } from "./readerArticle";

/** Reader mode: the article in Misty's own type, over the live page it came from. */
export function ReaderView(props: { article: ReaderArticle; onClose(): void }) {
  const { article } = props;
  const minutes = Math.max(1, Math.round(article.words / 230));
  return (
    <div
      className="absolute inset-0 z-10 overflow-y-auto bg-charcoal-bg text-cream"
      role="document"
      aria-label={`Reader: ${article.title}`}
    >
      <div className="sticky top-0 z-10 flex justify-end bg-charcoal-bg/90 px-4 py-2 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          <X className="size-3.5" aria-hidden />
          Exit reader
        </Button>
      </div>
      <article className="mx-auto max-w-[680px] px-6 pb-16 text-[17px] leading-[1.7]">
        <p className="text-xs uppercase tracking-wide text-cream-muted">{article.site}</p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight text-cream-bright">
          {article.title}
        </h1>
        <p className="mt-2 text-sm text-cream-muted">
          {[article.byline, `${minutes} min read`].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-8 grid gap-5">
          {article.blocks.map((block, index) => {
            switch (block.type) {
              case "heading": {
                const Tag = `h${block.level}` as "h2" | "h3" | "h4";
                return (
                  <Tag
                    key={index}
                    className="mt-4 text-xl font-semibold leading-snug text-cream-bright"
                  >
                    {block.text}
                  </Tag>
                );
              }
              case "paragraph":
                return <p key={index}>{block.text}</p>;
              case "quote":
                return (
                  <blockquote
                    key={index}
                    className="border-l-2 border-charcoal-border pl-4 text-cream-muted"
                  >
                    {block.text}
                  </blockquote>
                );
              case "code":
                return (
                  <pre
                    key={index}
                    className="overflow-x-auto rounded-md bg-charcoal-card p-3 font-mono text-sm leading-normal"
                  >
                    {block.text}
                  </pre>
                );
              case "list": {
                const List = block.ordered ? "ol" : "ul";
                return (
                  <List
                    key={index}
                    className={`${block.ordered ? "list-decimal" : "list-disc"} grid gap-1 pl-6`}
                  >
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>{item}</li>
                    ))}
                  </List>
                );
              }
              case "image":
                return (
                  <figure key={index} className="grid gap-2">
                    <img
                      src={block.src}
                      alt={block.alt}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="max-h-[70vh] w-full rounded-md object-contain"
                    />
                    {block.caption ? (
                      <figcaption className="text-sm text-cream-muted">{block.caption}</figcaption>
                    ) : null}
                  </figure>
                );
            }
          })}
        </div>
      </article>
    </div>
  );
}
