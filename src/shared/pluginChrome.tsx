import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2 text-sm text-zinc-200">
      <span className="font-medium">{props.label}</span>
      {props.children}
      {props.hint ? <span className="text-xs text-zinc-500">{props.hint}</span> : null}
    </label>
  );
}

export function StatusLine(props: {
  tone?: "neutral" | "success" | "error";
  children: ReactNode;
}) {
  const tone = props.tone ?? "neutral";
  return (
    <div className={`status-line ${tone}`} role="status" aria-live="polite">
      {props.children}
    </div>
  );
}

export function ActionButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`action-button ${props.className ?? ""}`.trim()}
    />
  );
}
