interface AuthMessageProps {
  tone: "error" | "success" | "muted";
  message: string;
}

const toneClasses: Record<AuthMessageProps["tone"], string> = {
  error: "border-danger/30 bg-danger/10 text-danger",
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  muted: "border-white/10 bg-white/[0.04] text-text-muted",
};

export default function AuthMessage({ tone, message }: AuthMessageProps) {
  return (
    <p className={`rounded-xl border px-4 py-3 text-sm leading-6 ${toneClasses[tone]}`}>
      {message}
    </p>
  );
}
