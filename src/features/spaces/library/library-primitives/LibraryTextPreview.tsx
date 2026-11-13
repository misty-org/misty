import { MistyMarkdown } from "@/features/agents";
import {
  cn,
  OverflowFadeText,
  PlaceholderIcon,
  Skeleton,
  Surface,
  Text,
  type TextTone,
  type TextWeight,
} from "@/shared/ui";
import { File } from "lucide-react";
import { useEffect, useState } from "react";
import { codeTokens, csvPreview } from "./codeTokens";
import type { TextPreviewKind } from "./textPreviewKind";

/** Nothing in a previewed page may load from the network or run. */
const PREVIEW_POLICY =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">";

const tokenLook: Record<string, { tone: TextTone; weight?: TextWeight; className?: string }> = {
  plain: { tone: "default" },
  keyword: { tone: "bright", weight: "semibold" },
  string: { tone: "muted" },
  number: { tone: "bright" },
  comment: { tone: "muted", className: "italic" },
};

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
  if (text === null) return <PlaceholderIcon icon={File} />;
  const frame = "pointer-events-none size-full overflow-hidden text-left";
  if (kind === "html")
    return (
      <Surface tone="page" className={frame}>
        <iframe
          title={`Preview of ${name}`}
          sandbox=""
          srcDoc={PREVIEW_POLICY + text}
          tabIndex={-1}
          className="h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
        />
      </Surface>
    );
  if (kind === "markdown")
    return (
      <Surface
        tone="page"
        className={cn(frame, "p-3 text-2xs leading-snug [&_h1]:text-sm [&_h2]:text-xs")}
      >
        <MistyMarkdown>{text.slice(0, 4000)}</MistyMarkdown>
      </Surface>
    );
  if (kind === "csv") {
    const rows = csvPreview(text);
    return (
      <Surface tone="page" className={cn(frame, "p-2")}>
        <table className="w-full table-fixed border-collapse text-3xs">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  // The first row is the header.
                  <Text
                    bare
                    as="td"
                    key={cellIndex}
                    tone={rowIndex ? undefined : "bright"}
                    weight={rowIndex ? undefined : "semibold"}
                    className="max-w-0 border-b px-1 py-0.5"
                  >
                    <OverflowFadeText>{cell}</OverflowFadeText>
                  </Text>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    );
  }
  const head = text.split("\n").slice(0, 18).join("\n");
  return (
    <Surface as="pre" tone="page" className={cn(frame, "m-0 p-3 font-mono text-3xs leading-snug")}>
      {codeTokens(head).map((token, index) => (
        <Text
          bare
          key={index}
          tone={tokenLook[token.kind]?.tone}
          weight={tokenLook[token.kind]?.weight}
          className={tokenLook[token.kind]?.className}
        >
          {token.text}
        </Text>
      ))}
    </Surface>
  );
}
