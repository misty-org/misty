import { Button } from "@/shared/ui";
import { ExternalLink, ShieldCheck } from "lucide-react";

export function BrowserNativeRuntimeRequired(props: { url: string; onOpenExternal: () => void }) {
  return (
    <div
      className="absolute inset-0 grid place-items-center overflow-y-auto bg-charcoal-bg p-6"
      data-testid="browser-native-runtime-required"
    >
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-5 grid size-12 place-items-center rounded-xl bg-charcoal-card text-sage-fg">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-base font-semibold tracking-[-0.02em] text-cream-bright">
          Open this page in the Misty desktop app
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-5 text-cream-muted">
          Misty runs websites in a separate native browser view. This build does not support
          embedded browser views.
        </p>
        <p className="mt-4 max-w-full truncate rounded-md bg-charcoal-card px-3 py-2 font-mono text-xs text-cream-muted">
          {props.url}
        </p>
        <Button className="mt-5" onClick={props.onOpenExternal}>
          <ExternalLink aria-hidden="true" />
          Open in browser
        </Button>
      </div>
    </div>
  );
}
