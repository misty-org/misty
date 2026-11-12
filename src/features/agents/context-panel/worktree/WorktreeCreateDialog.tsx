// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  SegmentedControl,
  Spinner,
  Switch,
} from "@/shared/ui";
import { currentSpaceKey } from "../../engines/enginesApi";
import { BranchCombobox } from "./BranchCombobox";
import {
  defaultBaseRef,
  defaultWorktreePath,
  isPlausibleBranchName,
  parsePrInput,
  randomBranchSuffix,
  suggestPrBranch,
} from "./prInput";
import {
  worktreeApi,
  type PrPreview,
  type WorktreeCreateArgs,
  type WorktreeListing,
} from "./worktreeApi";
import { useWorktreeStore } from "./worktreeStore";
import "./worktree.css";

type SourceTab = "new" | "existing" | "pr";

type ResolveError = "notGitHub" | "noOrigin" | "invalidPrInput";

const resolveErrorText: Record<ResolveError, string> = {
  notGitHub: "This repository's origin isn't on GitHub. Use an existing branch instead",
  noOrigin: "This repository has no origin remote",
  invalidPrInput: "That isn't a pull request number or GitHub link",
};

/** The pull request tab's preview: asked for a moment after typing stops, and again once the
 * title arrives (the branch name takes its words). A key stops the loop once it settles. */
function usePrPreview(tab: SourceTab, folder: string, prNumber: number | null, prInput: string) {
  const [preview, setPreview] = useState<PrPreview | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<ResolveError | null>(null);
  const seq = useRef(0);
  const lastKey = useRef("");
  // The suggested branch carries three random digits, kept while the number stays the same, or
  // every render would make a new name and the preview would chase it.
  const [suffix, setSuffix] = useState(() => ({ pr: prNumber, value: randomBranchSuffix() }));
  if (suffix.pr !== prNumber) setSuffix({ pr: prNumber, value: randomBranchSuffix() });
  const branchSuffix = suffix.value;
  useEffect(() => {
    if (tab !== "pr") return;
    if (!prNumber) {
      setPreview(null);
      setResolveError(null);
      setResolving(false);
      lastKey.current = "";
      return;
    }
    const mine = ++seq.current;
    setResolving(true);
    setResolveError(null);
    const timer = window.setTimeout(() => {
      const suggested = suggestPrBranch(prNumber, preview?.title, branchSuffix);
      const key = `${prNumber}|${suggested}`;
      if (lastKey.current === key) {
        setResolving(false);
        return;
      }
      lastKey.current = key;
      void worktreeApi
        .resolvePr(folder, prInput, suggested)
        .then((found) => {
          if (seq.current !== mine) return;
          setPreview(found);
          setResolving(false);
        })
        .catch((reason) => {
          if (seq.current !== mine) return;
          setPreview(null);
          setResolving(false);
          const text = String(reason);
          setResolveError(
            text.includes("not_github")
              ? "notGitHub"
              : text.includes("no_origin")
                ? "noOrigin"
                : "invalidPrInput",
          );
        });
    }, 400);
    return () => window.clearTimeout(timer);
    // The title takes part in the branch name, so a late title asks once more.
  }, [tab, folder, prNumber, prInput, preview?.title, branchSuffix]);
  const suggestedBranch = prNumber ? suggestPrBranch(prNumber, preview?.title, branchSuffix) : "";
  return { preview, resolving, resolveError, suggestedBranch };
}

/** A pull request's title, state, author and size, and anything in the way. */
function PrPreviewCard({
  preview,
  branch,
  base,
}: {
  preview: PrPreview;
  branch: string;
  base: string | null;
}) {
  return (
    <div className="worktree-pr-card">
      {preview.degraded ? (
        <p className="worktree-pr-line">
          Pull request #{preview.number} on {preview.repo}, fetched as pull/{preview.number}/head
        </p>
      ) : (
        <>
          <p className="worktree-pr-title">
            <span className="worktree-row-name">{preview.title}</span>
            {preview.state === "MERGED" ? (
              <span className="worktree-pr-state" data-state="merged">
                Merged
              </span>
            ) : null}
            {preview.state === "CLOSED" ? (
              <span className="worktree-pr-state" data-state="closed">
                Closed
              </span>
            ) : null}
          </p>
          <p className="worktree-pr-line">
            {[
              preview.author && `${preview.author} into ${base ?? "main"}`,
              typeof preview.additions === "number" &&
                `+${preview.additions} −${preview.deletions ?? 0}`,
              `Branch ${branch}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </>
      )}
      {preview.branchConflict ? (
        <p role="alert" className="worktree-alert">
          Branch {branch} already exists
        </p>
      ) : null}
      {preview.dirConflict ? (
        <p role="alert" className="worktree-alert">
          The folder for it already exists
        </p>
      ) : null}
    </div>
  );
}

/**
 * A new worktree of the folder's repository: from a new branch, an existing one or a GitHub
 * pull request. It starts in the background and the dialog closes at once; progress shows in
 * the worktree menu. Where it goes is shown, not asked: it is always beside the repository.
 */
export function WorktreeCreateDialog({
  folder,
  listing,
  open,
  onOpenChange,
}: {
  folder: string;
  listing: WorktreeListing;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const prefs = useWorktreeStore((s) => s.prefs);
  const [tab, setTab] = useState<SourceTab>("new");
  const [prInput, setPrInput] = useState("");
  const [branchName, setBranchName] = useState("");
  // Unpicked, the base follows the default worked out below.
  const [pickedBase, setPickedBase] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [switchAfter, setSwitchAfter] = useState(prefs.switchAfter);

  const prNumber = tab === "pr" ? parsePrInput(prInput) : null;
  const { preview, resolving, resolveError, suggestedBranch } = usePrPreview(
    tab,
    folder,
    prNumber,
    prInput,
  );
  const occupied = useMemo(
    () => new Set(listing.worktrees.map((w) => w.branch).filter((b): b is string => b != null)),
    [listing.worktrees],
  );
  const base = pickedBase ?? defaultBaseRef(listing.branches, listing.current);
  const effectiveBranch =
    tab === "pr" ? suggestedBranch : tab === "new" ? branchName.trim() : (existing ?? "");
  const localNames = useMemo(
    () => new Set(listing.branches.filter((b) => !b.isRemote).map((b) => b.name)),
    [listing.branches],
  );
  const localBranches = useMemo(
    () => listing.branches.filter((b) => !b.isRemote),
    [listing.branches],
  );
  const newInvalid =
    tab === "new" && branchName.trim() !== "" && !isPlausibleBranchName(branchName.trim());
  const newClash = tab === "new" && localNames.has(branchName.trim());
  const location = effectiveBranch ? defaultWorktreePath(listing.repository, effectiveBranch) : "";

  const canSubmit =
    effectiveBranch !== "" &&
    (tab === "pr"
      ? prNumber != null &&
        preview != null &&
        !resolving &&
        !preview.branchConflict &&
        !preview.dirConflict
      : tab === "new"
        ? !newInvalid && !newClash && base != null
        : existing != null && !occupied.has(existing));

  const submit = () => {
    if (!canSubmit) return;
    const store = useWorktreeStore.getState();
    store.setPrefs({ switchAfter });
    const args: WorktreeCreateArgs = {
      space: currentSpaceKey(),
      branch: effectiveBranch,
      baseRef: tab === "new" ? base : null,
      prNumber: tab === "pr" ? prNumber : null,
      existingBranch: tab === "existing",
    };
    store.start(folder, args, { switchAfter });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="worktree-dialog">
        <DialogHeader>
          <DialogTitle>New worktree</DialogTitle>
        </DialogHeader>
        <form
          className="worktree-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        >
          <SegmentedControl
            label="Start from"
            size="sm"
            value={tab}
            options={[
              { value: "new", label: "New branch" },
              { value: "existing", label: "Existing branch" },
              { value: "pr", label: "Pull request" },
            ]}
            onChange={setTab}
          />
          {tab === "pr" ? (
            <>
              <Field label="Pull request number or link">
                <Input
                  autoFocus
                  placeholder="1842 or https://github.com/owner/repo/pull/1842"
                  value={prInput}
                  aria-invalid={prInput.trim() !== "" && prNumber == null ? true : undefined}
                  onChange={(event) => setPrInput(event.target.value)}
                />
              </Field>
              {prInput.trim() !== "" && prNumber == null ? (
                <p role="alert" className="worktree-alert">
                  {resolveErrorText.invalidPrInput}
                </p>
              ) : null}
              {resolving ? (
                <p className="worktree-pr-line worktree-inline">
                  <Spinner size="sm" label="Looking up the pull request" />
                </p>
              ) : null}
              {resolveError ? (
                <p role="alert" className="worktree-alert">
                  {resolveErrorText[resolveError]}
                </p>
              ) : null}
              {preview ? (
                <PrPreviewCard preview={preview} branch={effectiveBranch} base={base} />
              ) : null}
            </>
          ) : null}
          {tab === "new" ? (
            <>
              <Field label="Branch name">
                <Input
                  autoFocus
                  placeholder="feature/parallel-review"
                  value={branchName}
                  aria-invalid={newInvalid || newClash ? true : undefined}
                  onChange={(event) => setBranchName(event.target.value)}
                />
              </Field>
              {newInvalid ? (
                <p role="alert" className="worktree-alert">
                  That isn't a valid branch name
                </p>
              ) : newClash ? (
                <p role="alert" className="worktree-alert">
                  Branch {branchName.trim()} already exists
                </p>
              ) : null}
              <div className="worktree-field">
                <Label>Start from</Label>
                <BranchCombobox
                  branches={listing.branches}
                  value={base}
                  onSelect={setPickedBase}
                  label="Branch to start from"
                  placeholder="Choose a branch"
                />
              </div>
            </>
          ) : null}
          {tab === "existing" ? (
            <div className="worktree-field">
              <Label>Branch</Label>
              <BranchCombobox
                branches={localBranches}
                value={existing}
                onSelect={setExisting}
                label="Branch"
                placeholder="Choose a branch"
                blocked={occupied}
                blockedReason="Checked out"
              />
            </div>
          ) : null}
          <Field label="Location">
            <Input readOnly value={location} placeholder="Beside the repository" title={location} />
          </Field>
          <label className="worktree-switch">
            <Switch checked={switchAfter} onCheckedChange={setSwitchAfter} />
            <span>Switch to it when it's ready</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create worktree
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
