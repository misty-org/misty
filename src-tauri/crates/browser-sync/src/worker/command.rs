//! Requests a `WorkerHandle` sends to its worker.
use super::*;

pub(super) enum Command {
    BrowserUnverified(oneshot::Sender<Result<()>>),
    ObserveBrowser(
        String,
        String,
        Vec<BrowserObservation>,
        oneshot::Sender<Result<BrowserCaptureState>>,
    ),
    Enqueue(String, Zeroizing<Vec<u8>>, oneshot::Sender<Result<String>>),
    Snapshot(oneshot::Sender<Result<Zeroizing<Vec<u8>>>>),
    PendingSnapshot(oneshot::Sender<Result<PendingSnapshot>>),
    ImportsApplied(u64, oneshot::Sender<Result<()>>),
    ReadBrowserProfile(String, oneshot::Sender<Result<BrowserProfileBinding>>),
    StageBrowserProfile(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserProfileBinding>>,
    ),
    ActivateBrowserProfile(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserProfileBinding>>,
    ),
    ForgetBrowserProfile(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserProfileBinding>>,
    ),
    ReadBrowserImport(String, oneshot::Sender<Result<BrowserImportJournal>>),
    BeginBrowserImport(
        String,
        u64,
        String,
        u64,
        oneshot::Sender<Result<BrowserImportJournal>>,
    ),
    FinishBrowserImport(
        String,
        u64,
        String,
        Vec<CredentialRecord>,
        oneshot::Sender<Result<BrowserImportJournal>>,
    ),
    QuarantineBrowserImport(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserImportJournal>>,
    ),
    WorkspaceChanges(Vec<crate::document::Change>, oneshot::Sender<Result<()>>),
    WorkspaceClaim(String, oneshot::Sender<Result<()>>),
    WorkspaceOpen(String, oneshot::Sender<Result<()>>),
    RecordsList(
        String,
        oneshot::Sender<Result<(u64, Vec<crate::document::ViewRecord>)>>,
    ),
    RecordsReady(String, oneshot::Sender<Result<bool>>),
    RecordsWrite(
        String,
        Vec<(String, Option<crate::document::ViewRecord>)>,
        oneshot::Sender<Result<()>>,
    ),
    WorkspaceSlotWrite(String, i16, Option<Vec<u8>>, oneshot::Sender<Result<()>>),
    WorkspaceSlotRead(
        String,
        String,
        i16,
        oneshot::Sender<Result<Option<Vec<u8>>>>,
    ),
    SigninStatus(
        String,
        oneshot::Sender<Result<crate::workspace::sync::SigninStatus>>,
    ),
    SigninWrite(
        String,
        Vec<(i16, Option<Vec<u8>>)>,
        std::collections::BTreeMap<i16, String>,
        oneshot::Sender<Result<()>>,
    ),
    SigninRead(String, i16, oneshot::Sender<Result<Option<Vec<u8>>>>),
    SigninBind(
        String,
        crate::store::DeviceSignin,
        oneshot::Sender<Result<()>>,
    ),
    Flush(oneshot::Sender<Result<()>>),
    ClipboardPublish(u8, Vec<u8>, oneshot::Sender<Result<()>>),
}
