import { open } from "@tauri-apps/plugin-dialog";
import {
  Cloud,
  Folder,
  FolderSearch,
  HardDrive,
  Images,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui";
import { useSmartLibraryStore } from "@/stores/media/useSmartLibraryStore";
import {
  formatEstimate,
  SmartLibraryAssetGrid,
  SmartLibraryBusy,
  SmartLibraryError,
  SmartLibraryFeature,
  SmartLibraryPreflightView,
  SmartLibraryProgressView,
} from "./ExplorerSmartLibraryViews";

export function SmartLibraryDialog(props: { workingDirectory: string; onClose: () => void }) {
  const {
    loaded,
    phase,
    library,
    progress,
    estimate,
    reindexPlan,
    reindexProcessed,
    error,
    load,
    chooseFolder,
    rescan,
    trySample,
    analyzeFolder,
    refreshProgress,
    checkIndexUpgrade,
    upgradeIndex,
    removeLibrary,
  } = useSmartLibraryStore(
    useShallow((state) => ({
      loaded: state.loaded,
      phase: state.phase,
      library: state.library,
      progress: state.progress,
      estimate: state.estimate,
      reindexPlan: state.reindexPlan,
      reindexProcessed: state.reindexProcessed,
      error: state.error,
      load: state.load,
      chooseFolder: state.chooseFolder,
      rescan: state.rescan,
      trySample: state.trySample,
      analyzeFolder: state.analyzeFolder,
      refreshProgress: state.refreshProgress,
      checkIndexUpgrade: state.checkIndexUpgrade,
      upgradeIndex: state.upgradeIndex,
      removeLibrary: state.removeLibrary,
    })),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFullAnalysis, setConfirmFullAnalysis] = useState(false);
  const [confirmIndexUpgrade, setConfirmIndexUpgrade] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseLocalFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose one Smart Library folder",
    });
    if (typeof selected === "string") await chooseFolder(selected);
  };
  const analyzedAssets = library?.assets.filter((asset) => asset.status === "analyzed") ?? [];
  const failedAssets = library?.assets.filter((asset) => asset.status === "failed") ?? [];
  const indexStatus = progress?.indexStatus ?? progress?.reindexStatus;
  const busy =
    phase === "scanning" ||
    phase === "uploading" ||
    phase === "processing" ||
    phase === "reindexing";

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) props.onClose();
        }}
      >
        <DialogContent className="flex h-[min(860px,calc(100vh-48px))] w-[min(860px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground [&>button]:hidden">
          <DialogHeader className="flex-row items-center justify-between gap-5 border-b border-border px-6 py-4 text-left">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Images size={20} />
              </span>
              <div className="min-w-0">
                <DialogTitle>Smart Library</DialogTitle>
                <DialogDescription className="mt-1 truncate">
                  Scan, review, and manage semantic metadata for Explorer search.
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {library ? (
                <Badge
                  variant="secondary"
                  className="hidden max-w-72 truncate md:inline-flex"
                  title={library.rootPath}
                >
                  {library.displayName} · {library.sourceKind === "cloud" ? "Cloud" : "Local"}
                </Badge>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="Close Library"
                disabled={busy}
                onClick={props.onClose}
              >
                <X size={18} />
              </Button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto">
            {!loaded || phase === "scanning" ? (
              <SmartLibraryBusy
                icon={<FolderSearch size={25} />}
                title={loaded ? "Scanning this folder" : "Loading your Library"}
                text={
                  loaded
                    ? "Reading filenames, formats, dates, and fingerprints locally. This does not use hosted AI."
                    : "Opening the private device catalog…"
                }
              />
            ) : !library ? (
              <LibraryOnboarding
                workingDirectory={props.workingDirectory}
                error={error}
                onChooseCurrent={chooseFolder}
                onChooseLocal={chooseLocalFolder}
              />
            ) : (
              <div className="grid min-h-full grid-rows-[auto_minmax(0,1fr)]">
                <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-popover/95 px-6 py-3 backdrop-blur">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="secondary">
                      {library.sourceKind === "cloud" ? (
                        <Cloud size={13} />
                      ) : (
                        <HardDrive size={13} />
                      )}
                      {library.preflight.totalImages.toLocaleString()} files
                    </Badge>
                    <Badge variant="secondary">
                      {analyzedAssets.length.toLocaleString()} analyzed
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void rescan()}
                    >
                      <RefreshCw size={14} />
                      Rescan
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      type="button"
                      aria-label="Remove Library"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 p-6">
                  {error ? (
                    <div className="mb-4">
                      <SmartLibraryError text={error} />
                    </div>
                  ) : null}
                  {phase === "uploading" ? (
                    <SmartLibraryBusy
                      icon={<Cloud size={25} />}
                      title="Preparing private analysis"
                      text="Misty sends EXIF-stripped thumbnails for visuals or bounded extracted text and metadata for other files, in batches of eight. Paths and originals remain on your device."
                    />
                  ) : phase === "reindexing" ? (
                    <SmartLibraryBusy
                      icon={<RefreshCw size={25} />}
                      title="Improving metadata and search"
                      text={`${reindexProcessed.toLocaleString()} assets securely refreshed. Misty repairs sparse legacy descriptions and rebuilds the semantic index from path-free previews or extracted metadata.`}
                    />
                  ) : phase === "processing" ? (
                    <SmartLibraryProgressView progress={progress} onRefresh={refreshProgress} />
                  ) : analyzedAssets.length > 0 ? (
                    <div className="grid gap-6">
                      <section className="grid gap-4 rounded-lg bg-muted/30 p-5">
                        <div className="flex flex-wrap items-end justify-between gap-4">
                          <div>
                            <h3 className="m-0 text-xl font-semibold">Sample review</h3>
                            <p className="m-0 mt-1 text-sm text-muted-foreground">
                              Review descriptions, tags, confidence, and virtual collections before
                              analyzing more.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {indexStatus?.upgradeNeeded ? (
                              <Button
                                variant="outline"
                                type="button"
                                onClick={() => {
                                  void checkIndexUpgrade().then(() => setConfirmIndexUpgrade(true));
                                }}
                              >
                                <RefreshCw size={15} />
                                Improve metadata &amp; index
                              </Button>
                            ) : indexStatus ? (
                              <Badge variant="secondary">
                                Semantic index v{indexStatus.currentVersion} current
                              </Badge>
                            ) : null}
                            {library.preflight.eligibleImages > 0 ? (
                              <Button type="button" onClick={() => setConfirmFullAnalysis(true)}>
                                <Sparkles size={16} />
                                Analyze this folder
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-start gap-3 rounded-md bg-primary/10 px-4 py-3 text-sm text-primary">
                          <Search className="mt-0.5 shrink-0" size={17} />
                          <span>
                            Metadata is ready. Search for these files from Explorer’s centered{" "}
                            <strong>Spotlight search</strong>.
                          </span>
                        </div>
                      </section>
                      <SmartLibraryAssetGrid assets={analyzedAssets} library={library} />
                      {failedAssets.length > 0 ? (
                        <p className="m-0 text-sm text-destructive">
                          {failedAssets.length} file{failedAssets.length === 1 ? "" : "s"} failed.
                          Failed analysis and infrastructure retries do not use hosted AI.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <SmartLibraryPreflightView
                      library={library}
                      estimate={estimate}
                      onTrySample={trySample}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirmDelete}
        title="Remove Smart Library?"
        description="Remove this device catalog and its generated semantic metadata. Original files stay in place."
        confirmLabel="Remove Library"
        destructive
        onOpenChange={setConfirmDelete}
        onConfirm={() => void removeLibrary()}
      />
      <ConfirmationDialog
        open={confirmFullAnalysis}
        title="Analyze the remaining folder?"
        description={`${formatEstimate(estimate ?? library?.preflight.estimate ?? null)} Only successfully analyzed files are charged; this does not move or rename anything.`}
        confirmLabel="Approve Analysis"
        onOpenChange={setConfirmFullAnalysis}
        onConfirm={() => void analyzeFolder()}
      />
      <ConfirmationDialog
        open={confirmIndexUpgrade}
        title="Improve metadata and search?"
        description={`${indexStatus?.outdatedAssets ?? reindexPlan?.assets.length ?? 0} assets need index v${reindexPlan?.targetVersion ?? "latest"}. This batch uses about ${Math.ceil((reindexPlan?.hostedAIWeeklyRatio ?? 0) * 100)}% of your weekly hosted AI usage. Misty may resend private path-free previews, and it never runs automatically.`}
        confirmLabel="Approve Improvements"
        confirmDisabled={!reindexPlan}
        onOpenChange={setConfirmIndexUpgrade}
        onConfirm={() => void upgradeIndex()}
      />
    </>
  );
}

function LibraryOnboarding(props: {
  workingDirectory: string;
  error: string | null;
  onChooseCurrent: (path: string) => Promise<void>;
  onChooseLocal: () => Promise<void>;
}) {
  return (
    <div className="grid min-h-full place-items-center p-8">
      <div className="grid w-full max-w-3xl justify-items-center gap-7 text-center">
        <div className="grid size-20 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles size={34} />
        </div>
        <div className="grid gap-3">
          <h3 className="m-0 text-2xl font-semibold tracking-tight">
            Understand your files, not just their folders.
          </h3>
          <p className="m-0 mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Smart Library first scans one folder locally, then analyzes a representative 25-file
            sample. Originals stay where they are; organization is virtual and reversible.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-3">
          <SmartLibraryFeature
            icon={<Search size={18} />}
            title="Natural search"
            text="Find files by subjects, visible text, and extracted content."
          />
          <SmartLibraryFeature
            icon={<Images size={18} />}
            title="Collections"
            text="Review AI organization before scaling."
          />
          <SmartLibraryFeature
            icon={<ShieldAlert size={18} />}
            title="Private analysis"
            text="Paths and originals stay on device."
          />
        </div>
        {props.error ? <SmartLibraryError text={props.error} /> : null}
        <div className="flex flex-wrap justify-center gap-3">
          {props.workingDirectory ? (
            <Button
              type="button"
              onClick={() => void props.onChooseCurrent(props.workingDirectory)}
            >
              <Folder size={18} />
              Use Current Folder
            </Button>
          ) : null}
          <Button variant="outline" type="button" onClick={() => void props.onChooseLocal()}>
            <HardDrive size={18} />
            Choose Local Folder
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          Connected-cloud folders can be selected by opening them in Files and choosing Use Current
          Folder.
        </span>
      </div>
    </div>
  );
}

function ConfirmationDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" type="button" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={props.destructive ? "destructive" : "default"}
            type="button"
            disabled={props.confirmDisabled}
            onClick={() => {
              props.onOpenChange(false);
              props.onConfirm();
            }}
          >
            {props.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
