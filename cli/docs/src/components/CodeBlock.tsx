import { useState } from "react";
import { CheckIcon, CopyIcon, TerminalIcon } from "./Icons";

interface CodeBlockProps {
  code: string;
  label?: string;
}

export function CodeBlock({ code, label = "Terminal" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="code-block">
      <div className="code-header">
        <span>
          <TerminalIcon />
          {label}
        </span>
        <button
          type="button"
          className="copy-button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
