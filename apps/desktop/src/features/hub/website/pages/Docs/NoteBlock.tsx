const styles = {
  tip: {
    border: "border-white/12",
    bg: "bg-white/[0.03]",
    icon: "text-white/80",
    label: "Tip",
  },
  note: {
    border: "border-white/12",
    bg: "bg-white/[0.02]",
    icon: "text-white/70",
    label: "Note",
  },
  warning: {
    border: "border-white/18",
    bg: "bg-white/[0.04]",
    icon: "text-white",
    label: "Warning",
  },
};

export default function NoteBlock({
  kind,
  text,
}: {
  kind: "tip" | "note" | "warning";
  text: string;
}) {
  const s = styles[kind];
  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} p-4`}>
      <span className={`text-xs font-semibold tracking-[0.14em] ${s.icon}`}>
        {s.label}
      </span>
      <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">
        {text}
      </p>
    </div>
  );
}
