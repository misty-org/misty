import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, OptionSelect, cn } from "@/shared/ui";
import { BrowserLogo } from "./BrowserLogo";
import { ImportResults } from "./ImportResults";
import { ImportReview, reviewRows, type ReviewRow } from "./ImportReview";
import { chosenProfile, enter, ImportSourceList, type ChosenSource } from "./ImportSourceList";
import { browserImport, type ImportedExtension, type ImportSource } from "./native";
import { importBookmarksFile, runImport, type ImportKind, type ImportOutcome } from "./runImport";
import { importIntoNewSpace, type SpaceImport } from "./spaceImport";

type Step =
  | { name: "choose" }
  | { name: "review"; source: ChosenSource }
  | {
      name: "import";
      source?: ChosenSource;
      kinds: ImportKind[];
      outcomes: ImportOutcome[];
      done: boolean;
    }
  /** Handed to a new Space's window, which runs the import. */
  | { name: "handed"; source: ChosenSource; space: string };

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
export function BrowserImportFlow(props: {
  onClose(): void;
  closeLabel?: string;
  /** An import another window chose for this Space; it starts at once. */
  start?: Pick<SpaceImport, "source" | "kinds" | "extensions">;
}) {
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [step, setStep] = useState<Step>(() =>
    props.start
      ? { name: "import", source: props.start.source, kinds: props.start.kinds, outcomes: [], done: false }
      : { name: "choose" },
  );
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [extensions, setExtensions] = useState<ImportedExtension[]>([]);
  const [chosen, setChosen] = useState<Set<ImportKind>>(new Set());
  const [issue, setIssue] = useState("");
  // A profile can come in as a Space of its own, as a Chrome profile is one.
  const [ownSpace, setOwnSpace] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [handing, setHanding] = useState(false);

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
    setSpaceName(source.profileName ?? source.name);
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

  const begin = (source: ChosenSource, kinds: ImportKind[], extensions: ImportedExtension[]) => {
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
  const started = useRef(false);
  useEffect(() => {
    if (!props.start || started.current) return;
    started.current = true;
    begin(props.start.source, props.start.kinds, props.start.extensions);
    // Runs once, for the import this window opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (source: ChosenSource) => {
    const kinds = [...chosen];
    const name = spaceName.trim();
    if (!ownSpace || !name) return begin(source, kinds, extensions);
    setHanding(true);
    setIssue("");
    importIntoNewSpace(name, { source, kinds, extensions })
      .then(() => setStep({ name: "handed", source, space: name }))
      .catch((error: unknown) =>
        setIssue(error instanceof Error ? error.message : "That Space couldn't be made. Try again."),
      )
      .finally(() => setHanding(false));
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
      {step.name === "review" && rows && rows.length > 0 && (
        <div className={cn("grid gap-2 rounded-md px-2 py-2", enter)}>
          <div className="flex items-start gap-3">
            <Checkbox
              id="browser-import-own-space"
              className="mt-0.5"
              checked={ownSpace}
              onCheckedChange={(value) => setOwnSpace(value === true)}
            />
            <label htmlFor="browser-import-own-space" className="grid min-w-0 gap-0.5">
              <span className="text-sm text-cream-bright">Make a Space for this profile</span>
              <span className="text-xs text-cream-muted">
                It opens in its own window with its own sign-ins, and everything comes in there.
              </span>
            </label>
          </div>
          {ownSpace && (
            <Input
              aria-label="Name of the new Space"
              className="ml-7 w-auto"
              maxLength={80}
              value={spaceName}
              onChange={(event) => setSpaceName(event.target.value)}
            />
          )}
        </div>
      )}
      {step.name === "handed" && (
        <p className="text-sm text-cream-muted">
          {`“${step.space}” opened in its own window, and ${step.source.name} is coming in there.`}
        </p>
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
            <Button
              disabled={!rows || chosen.size === 0 || handing || (ownSpace && !spaceName.trim())}
              onClick={() => start(step.source)}
            >
              Import
            </Button>
          </>
        )}
        {step.name === "handed" && <Button onClick={props.onClose}>Done</Button>}
        {step.name === "import" && (
          <Button disabled={!step.done} onClick={props.onClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
