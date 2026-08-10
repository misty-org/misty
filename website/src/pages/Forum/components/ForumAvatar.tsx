export default function ForumAvatar({
  initials,
  size = "sm",
}: {
  initials: string;
  size?: "sm" | "md";
}) {
  const s = size === "md" ? "w-9 h-9 text-xs" : "w-7 h-7 text-[10px]";
  return (
    <div
      className={`${s} rounded-full bg-elevated border border-border flex items-center justify-center font-semibold text-text-muted shrink-0`}
    >
      {initials}
    </div>
  );
}
