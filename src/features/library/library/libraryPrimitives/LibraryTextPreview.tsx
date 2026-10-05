import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import { Skeleton, cn } from "@/shared/ui";
import { File } from "lucide-react";
import { useEffect, useState } from "react";
import { codeTokens, csvPreview } from "./codeTokens";
import type { TextPreviewKind } from "./textPreviewKind";

/** Nothing in a previewed page may load from the network or run. */
const PREVIEW_POLICY =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">";

const tokenClass = {
  plain: "text-cream",
  keyword: "font-semibold text-cream-bright",
  string: "text-cream-muted",
  number: "text-cream-bright",
  comment: "italic text-cream-muted/70",
} as const;

/**
 * A live preview of a small text file: HTML rendered in a sandbox with no
 * scripts and no access to Misty, Markdown formatted, CSV as a table and code
 * with a monochrome highlight. The first screenful only.
 */
export function LibraryTextPreview({
  kind,
  name,
  load,
}: {
  kind: TextPreviewKind;
  name: string;
  load: () => Promise<Blob>;
}) {
  const [text, setText] = useState<string | null>();
  useEffect(() => {
    let current = true;
    setText(undefined);
    void load()
      .then((blob) => blob.text())
      .then((value) => current && setText(value))
      .catch(() => current && setText(null));
    return () => {
      current = false;
    };
  }, [load]);
  if (text === undefined) return <Skeleton className="size-full rounded-none" />;
  if (text === null) return <File size={30} />;
  const frame = "pointer-events-none size-full overflow-hidden bg-charcoal-workspace text-left";
  if (kind === "html")
    return (
      <div className={frame}>
        <iframe
          title={`Preview of ${name}`}
          sandbox=""
          srcDoc={PREVIEW_POLICY + text}
          tabIndex={-1}
          className="h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
        />
      </div>
    );
  if (kind === "markdown")
    return (
      <div className={cn(frame, "p-3 text-[11px] leading-snug [&_h1]:text-sm [&_h2]:text-xs")}>
        <MistyMarkdown>{text.slice(0, 4000)}</MistyMarkdown>
      </div>
    );
  if (kind === "csv") {
    const rows = csvPreview(text);
    return (
      <div className={cn(frame, "p-2")}>
        <table className="w-full table-fixed border-collapse text-[10px]">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex ? "" : "font-semibold text-cream-bright"}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="truncate border-b border-charcoal-border/60 px-1 py-0.5"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const head = text.split("\n").slice(0, 18).join("\n");
  return (
    <pre className={cn(frame, "m-0 p-3 font-mono text-[10px] leading-snug")}>
      {codeTokens(head).map((token, index) => (
        <span key={index} className={tokenClass[token.kind]}>
          {token.text}
        </span>
      ))}
    </pre>
  );
}
