import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="plugin-field">
      <span className="font-medium">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
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
