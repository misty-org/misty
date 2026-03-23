import { X } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";

export function PanelModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="flex max-h-[min(80vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0a0d10] shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#f4f4f5]">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-[#8f8f8f]">{subtitle}</p> : null}
          </div>
          <button
            aria-label="Close modal"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[#9aa3af] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
