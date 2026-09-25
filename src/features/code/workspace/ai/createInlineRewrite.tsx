import { useEffect, useRef } from "react";
interface InlineRewriteProps {
  open: boolean;
  selection: string;
  language: string;
  filename: string;
  onClose: () => void;
  onApply: (text: string) => void;
  onOpenSettings: () => void;
}
/** Compatibility mount: the Code command opens Misty, never an app-owned prompt. */
export function createInlineRewrite(services: {
  openMisty: () => Promise<void>;
  report: (error: unknown) => void;
}) {
  return function MistyCodeHandoff({ open, onClose }: InlineRewriteProps) {
    const opened = useRef(false);
    useEffect(() => {
      if (!open) {
        opened.current = false;
        return;
      }
      if (opened.current) return;
      opened.current = true;
      void services.openMisty().then(onClose).catch(services.report);
    }, [open, onClose]);
    return null;
  };
}
