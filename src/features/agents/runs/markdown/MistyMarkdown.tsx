import type { Prose } from "@misty/ui";
import { lazy, memo, Suspense, type ComponentProps } from "react";

const loadView = () => import("./MistyMarkdownView");

const MistyMarkdownView = lazy(() =>
  loadView().then((module) => ({ default: module.MistyMarkdown })),
);

if (typeof window !== "undefined") {
  const preload = () => void loadView().catch(() => undefined);
  if (typeof window.requestIdleCallback === "function")
    window.requestIdleCallback(preload, { timeout: 2000 });
  else window.setTimeout(preload, 300);
}

export const MistyMarkdown = memo(function MistyMarkdown(props: {
  children: string;
  streaming?: boolean;
  size?: ComponentProps<typeof Prose>["size"];
  className?: string;
}) {
  return (
    <Suspense fallback={null}>
      <MistyMarkdownView {...props} />
    </Suspense>
  );
});
