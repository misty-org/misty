


const styles = {
  tip: { border: "border-green-500/30", bg: "bg-green-500/5", icon: "text-green-400", label: "Tip" },
  note: { border: "border-blue-500/30", bg: "bg-blue-500/5", icon: "text-blue-400", label: "Note" },
  warning: { border: "border-amber-500/30", bg: "bg-amber-500/5", icon: "text-amber-400", label: "Warning" },
};

export default function NoteBlock({ kind, text }: { kind: "tip" | "note" | "warning"; text: string }) {
  const s = styles[kind];
  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} p-4`}>
      <span className={`text-xs font-semibold uppercase tracking-wider ${s.icon}`}>{s.label}</span>
      <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">{text}</p>
    </div>
  );
}
