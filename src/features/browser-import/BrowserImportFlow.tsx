import { useEffect, useState } from "react";
import { Button, OptionSelect, cn } from "@/shared/ui";
import { BrowserLogo } from "./BrowserLogo";
import { ImportResults } from "./ImportResults";
import { ImportReview, reviewRows, type ReviewRow } from "./ImportReview";
import { chosenProfile, enter, ImportSourceList, type ChosenSource } from "./ImportSourceList";
import { browserImport, type ImportedExtension, type ImportSource } from "./native";
import { importBookmarksFile, runImport, type ImportKind, type ImportOutcome } from "./runImport";

type Step =
  | { name: "choose" }
  | { name: "review"; source: ChosenSource }
  | {
      name: "import";
      source?: ChosenSource;
      kinds: ImportKind[];
      outcomes: ImportOutcome[];
      done: boolean;
    };

const chromiumFamily = new Set(["chrome", "edge", "brave", "arc", "vivaldi", "opera", "chromium"]);
/** "Misty found Zen and Google Chrome on this computer." */
function foundSentence(sources: ImportSource[] | null) {
  const names = sources?.map((s) => s.name) ?? [];
  if (!names.length) return "";
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Misty found ${list} on this computer.`;
}
const onMac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * Brings bookmarks, history, settings, sign-ins and extensions over from
 * another browser on this computer, or bookmarks from a file. Used in
 * onboarding, Settings > Browser and the Bookmarks page.
 */
export function BrowserImportFlow(props: { onClose(): void; closeLabel?: string }) {
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [extensions, setExtensions] = useState<ImportedExtension[]>([]);
  const [chosen, setChosen] = useState<Set<ImportKind>>(new Set());
  const [issue, setIssue] = useState("");

  useEffect(() => {
    let live = true;
    browserImport
      .discover()
      .then((found) => live && setSources(found))
      .catch(() => live && setSources([]));
    return () => {
      live = false;
    };
  }, []);

  const review = (source: ChosenSource) => {
    setStep({ name: "review", source });
    setRows(null);
    setIssue("");
    browserImport
      .preview(source)
      .then((preview) => {
        const next = reviewRows(preview, onMac() && chromiumFamily.has(source.browser));
        setRows(next);
        setExtensions(preview.extensions);
        setChosen(new Set(next.filter((row) => row.available).map((row) => row.kind)));
      })
      .catch((error: unknown) => {
        setIssue(error instanceof Error ? error.message : String(error));
        setRows([]);
      });
  };

  const start = (source: ChosenSource) => {
    const kinds = [...chosen];
    setStep({ name: "import", source, kinds, outcomes: [], done: false });
    void runImport(source, kinds, extensions, (outcome) =>
      setStep((current) =>
        current.name === "import"
          ? { ...current, outcomes: [...current.outcomes, outcome] }
          : current,
      ),
    ).then(() =>
      setStep((current) => (current.name === "import" ? { ...current, done: true } : current)),
    );
  };

  const importFile = async () => {
    const outcome = await importBookmarksFile();
    if (outcome) setStep({ name: "import", kinds: ["bookmarks"], outcomes: [outcome], done: true });
  };

  const source = step.name === "choose" ? undefined : step.source;
  const detected = source && sources?.find((s) => s.browser === source.browser);
  return (
    <div key={step.name} className={cn("grid gap-4", enter)}>
      {source ? (
        <div className="flex items-center gap-3">
          <BrowserLogo browser={source.browser} size={28} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
            {source.name}
          </span>
          {step.name === "review" && detected && detected.profiles.length > 1 && (
            <OptionSelect
              aria-label={`${source.name} profile`}
              className="w-40"
              value={source.profile}
              options={detected.profiles.map((p) => ({ value: p.id, label: p.name }))}
              onValueChange={(id) => review(chosenProfile(detected, id))}
            />
          )}
          {step.name !== "review" && source.profileName && (
            <span className="truncate text-xs text-cream-muted">{source.profileName}</span>
          )}
        </div>
      ) : (
        step.name === "choose" && (
          <p className="text-sm text-cream-muted">
            {foundSentence(sources)} Bring your bookmarks, history, settings and sign-ins with you;
            nothing changes in the other browser.
          </p>
        )
      )}
      {step.name === "choose" && (
        <>
          <ImportSourceList sources={sources} onChoose={review} onFile={() => void importFile()} />
          {sources?.length === 0 && (
            <p className="text-xs text-cream-muted">
              No other browsers were found on this computer. A bookmarks file still works.
            </p>
          )}
        </>
      )}
      {step.name === "review" && (
        <ImportReview
          rows={rows}
          chosen={chosen}
          onToggle={(kind, on) =>
            setChosen((current) => {
              const next = new Set(current);
              if (on) next.add(kind);
              else next.delete(kind);
              return next;
            })
          }
        />
      )}
      {issue && (
        <p role="alert" className="text-sm text-destructive">
          {issue}
        </p>
      )}
      {step.name === "import" && (
        <ImportResults kinds={step.kinds} outcomes={step.outcomes} onLeave={props.onClose} />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {step.name === "choose" && (
          <Button variant="ghost" onClick={props.onClose}>
            {props.closeLabel ?? "Cancel"}
          </Button>
        )}
        {step.name === "review" && (
          <>
            <Button variant="ghost" onClick={() => setStep({ name: "choose" })}>
              Back
            </Button>
            <Button disabled={!rows || chosen.size === 0} onClick={() => start(step.source)}>
              Import
            </Button>
          </>
        )}
        {step.name === "import" && (
          <Button disabled={!step.done} onClick={props.onClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
