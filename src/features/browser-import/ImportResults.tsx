import { Check, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router";
import { Button, Spinner, cn } from "@/shared/ui";
import { enter } from "./ImportSourceList";
import type { ImportKind, ImportOutcome } from "./runImport";

const labels: Record<ImportKind, string> = {
  bookmarks: "Bookmarks",
  history: "History",
  settings: "Settings",
  signins: "Signed-in sites",
  extensions: "Extensions",
};

/** Each chosen kind with its outcome as it finishes. Status reads as text and icons. */
export function ImportResults(props: {
  kinds: ImportKind[];
  outcomes: ImportOutcome[];
  onLeave?(): void;
}) {
  const navigate = useNavigate();
  return (
    <ul className="grid gap-1" aria-label="Import progress" aria-live="polite">
      {props.kinds.map((kind, index) => {
        const outcome = props.outcomes.find((o) => o.kind === kind);
        return (
          <li
            key={kind}
            className={cn("flex items-start gap-3 rounded-md px-2 py-2", enter)}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-cream-muted">
              {!outcome ? (
                <Spinner label={`Importing ${labels[kind].toLowerCase()}`} />
              ) : outcome.ok ? (
                <Check size={16} className="text-cream-bright" aria-label="Done" />
              ) : (
                <CircleAlert size={16} className="text-cream-bright" aria-label="Didn't import" />
              )}
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm text-cream-bright">{labels[kind]}</span>
              {outcome && (
                <span className={cn("text-xs text-cream-muted", enter)}>{outcome.message}</span>
              )}
              {outcome?.extensions?.length ? (
                <ul className="mt-1 grid gap-1">
                  {outcome.extensions.map((extension) => (
                    <li key={extension.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-cream-bright">
                        {extension.name}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          props.onLeave?.();
                          navigate(`/extensions?q=${encodeURIComponent(extension.name)}`);
                        }}
                      >
                        Find
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
