//! One entry point for every code tool, used by the desktop's device jobs.
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::{
    beneath, checkpoint::Checkpoints, exec, files, io_fix, preview::Previews, processes,
    proxy, sandbox, CodeError,
};

/// A folder the person shared as a project.
#[derive(Clone, Debug)]
pub struct Project {
    pub scope_id: String,
    /// Canonical path, checked with [`CodeService::check_root`].
    pub root: PathBuf,
    /// Whether commands may install packages through the proxy.
    pub allow_installs: bool,
}

pub struct CodeService {
    data: PathBuf,
    user_home: Option<PathBuf>,
    /// Folders that hold Misty's own data: never a project, never inside one.
    protected: Vec<PathBuf>,
    checkpoints: Checkpoints,
    processes: processes::Registry,
    previews: Previews,
    proxy: tokio::sync::Mutex<Option<Arc<proxy::Proxy>>>,
    /// Commands running at once, per project.
    running: std::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Semaphore>>>,
}

/// Commands one project may run at the same time; more wait their turn.
const PARALLEL_COMMANDS: usize = 4;

/// Every operation, as named in device jobs and grants.
pub const OPERATIONS: &[&str] = &[
    "code.read",
    "code.list",
    "code.find",
    "code.search",
    "code.write",
    "code.edit",
    "code.run",
    "code.start",
    "code.logs",
    "code.processes",
    "code.stop",
    "code.preview",
];

fn parse<T: DeserializeOwned>(input: Value) -> Result<T, CodeError> {
    serde_json::from_value(input)
        .map_err(|error| CodeError::fix(format!("The arguments don't fit this tool: {error}")))
}

impl CodeService {
    pub fn new(data: PathBuf, user_home: Option<PathBuf>) -> Self {
        Self {
            checkpoints: Checkpoints::new(data.join("checkpoints")),
            data,
            user_home,
            protected: Vec::new(),
            processes: processes::Registry::default(),
            previews: Previews::default(),
            proxy: tokio::sync::Mutex::new(None),
            running: Default::default(),
        }
    }

    /// Also refuses projects in or around these folders (Misty's data root).
    pub fn with_protected(mut self, folders: Vec<PathBuf>) -> Self {
        self.protected = folders
            .into_iter()
            .map(|folder| folder.canonicalize().unwrap_or(folder))
            .collect();
        self
    }

    /// Folders that can't become projects: the disk, the home folder itself,
    /// system and library folders, and anything holding Misty's own data.
    pub fn check_root(&self, root: &Path) -> Result<(), CodeError> {
        let refuse = |why: &str| Err(CodeError::Scope(why.to_owned()));
        if !root.is_absolute() || root.parent().is_none() {
            return refuse("Choose a project folder, not the whole disk.");
        }
        if self.data.starts_with(root)
            || self
                .protected
                .iter()
                .any(|folder| folder.starts_with(root) || root.starts_with(folder))
        {
            return refuse("That folder holds Misty's own data.");
        }
        // Temporary folders are fine; the rest of these belong to the system.
        let temporary = ["/private/tmp/", "/private/var/folders/"]
            .iter()
            .any(|prefix| root.to_string_lossy().starts_with(prefix));
        for system in ["/System", "/Library", "/usr", "/bin", "/sbin", "/private", "/etc", "/var", "/tmp", "/opt", "/Applications", "/Volumes", "/Users", "/cores", "/dev"] {
            let inside = root.starts_with(system) && !matches!(system, "/Volumes" | "/Users");
            if root == Path::new(system) || (inside && !temporary) {
                return refuse("System folders can't be projects.");
            }
        }
        if let Some(home) = &self.user_home {
            if root == home || home.starts_with(root) {
                return refuse("Choose a folder inside your home folder, not the home folder itself.");
            }
            for private in ["Library", ".ssh", ".aws", ".config", ".gnupg", ".kube", ".docker"] {
                if root.starts_with(home.join(private)) {
                    return refuse("That folder holds app data or keys, so it can't be a project.");
                }
            }
        }
        Ok(())
    }

    fn scratch(&self, project: &Project, run_id: &str) -> Result<(PathBuf, PathBuf), CodeError> {
        let valid = |value: &str| {
            !value.is_empty()
                && value.len() <= 120
                && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        };
        if !valid(&project.scope_id) || !valid(run_id) {
            return Err(CodeError::Scope("invalid project or run".into()));
        }
        let home = self.data.join("homes").join(&project.scope_id);
        let temp = self.data.join("tmp").join(&project.scope_id).join(run_id);
        for dir in [&home, &temp] {
            std::fs::create_dir_all(dir).map_err(|error| {
                CodeError::Unavailable(format!("Could not prepare the command folder: {error}"))
            })?;
        }
        Ok((
            home.canonicalize().unwrap_or(home),
            temp.canonicalize().unwrap_or(temp),
        ))
    }

    async fn proxy_port(&self, project: &Project) -> Result<Option<u16>, CodeError> {
        if !project.allow_installs {
            return Ok(None);
        }
        let mut proxy = self.proxy.lock().await;
        if proxy.is_none() {
            *proxy = Some(Arc::new(proxy::start().await.map_err(|error| {
                CodeError::Unavailable(format!("The package proxy couldn't start: {error}"))
            })?));
        }
        Ok(proxy.as_ref().map(|proxy| proxy.port))
    }

    async fn setup(
        &self,
        project: &Project,
        run_id: &str,
        cwd: &str,
        command: &str,
    ) -> Result<sandbox::Setup, CodeError> {
        exec::check_command(command)?;
        let cwd = beneath::clean_relative(cwd)?;
        if let Some(reason) = beneath::protected(&cwd) {
            return Err(CodeError::fix(reason));
        }
        let root = beneath::open_root(&project.root)
            .map_err(|error| CodeError::Scope(format!("project unavailable: {error}")))?;
        beneath::open_dir(&root, &cwd).map_err(|error| io_fix("use that folder", error))?;
        let (home, temp) = self.scratch(project, run_id)?;
        let proxy_port = self.proxy_port(project).await?;
        let policy = sandbox::Policy {
            project: &project.root,
            temp: &temp,
            home: &home,
            user_home: self.user_home.as_deref(),
            proxy_port,
        };
        sandbox::setup(&policy, &project.root.join(cwd), command)
    }

    fn ensure_checkpoint(&self, project: &Project, run_id: &str) -> Result<(), CodeError> {
        self.checkpoints.ensure(&project.scope_id, run_id, &project.root)
    }

    /// Runs one code tool for one run in one project.
    pub async fn execute(
        &self,
        project: &Project,
        run_id: &str,
        operation: &str,
        input: Value,
    ) -> Result<Value, CodeError> {
        self.check_root(&project.root)?;
        if !project.root.is_dir() {
            return Err(CodeError::Scope("The project folder is missing.".into()));
        }
        let root_path = project.root.clone();
        let blocking = |work: Box<dyn FnOnce(&std::fs::File) -> Result<Value, CodeError> + Send>| {
            let root_path = root_path.clone();
            async move {
                tokio::task::spawn_blocking(move || {
                    let root = beneath::open_root(&root_path)
                        .map_err(|error| CodeError::Scope(format!("project unavailable: {error}")))?;
                    work(&root)
                })
                .await
                .map_err(|_| CodeError::Unavailable("The file tool stopped.".into()))?
            }
        };
        match operation {
            "code.read" => {
                let request: files::ReadRequest = parse(input)?;
                blocking(Box::new(move |root| files::read(root, request))).await
            }
            "code.list" => {
                let request: files::ListRequest = parse(input)?;
                blocking(Box::new(move |root| files::list(root, request))).await
            }
            "code.find" => {
                let request: files::FindRequest = parse(input)?;
                let path = root_path.clone();
                blocking(Box::new(move |root| files::find(&path, root, request))).await
            }
            "code.search" => {
                let request: files::SearchRequest = parse(input)?;
                let path = root_path.clone();
                blocking(Box::new(move |root| files::search(&path, root, request))).await
            }
            "code.write" | "code.edit" => {
                let edit = operation == "code.edit";
                let write: Option<files::WriteRequest> = if edit { None } else { Some(parse(input.clone())?) };
                let change: Option<files::EditRequest> = if edit { Some(parse(input)?) } else { None };
                self.checkpointed(project, run_id).await?;
                blocking(Box::new(move |root| match (write, change) {
                    (Some(request), _) => files::write(root, request),
                    (_, Some(request)) => files::edit(root, request),
                    _ => Err(CodeError::fix("nothing to do")),
                }))
                .await
            }
            "code.run" => {
                let request: exec::RunRequest = parse(input)?;
                let setup = self.setup(project, run_id, &request.cwd, &request.command).await?;
                self.checkpointed(project, run_id).await?;
                let slots = self
                    .running
                    .lock()
                    .map(|mut running| {
                        running
                            .entry(project.scope_id.clone())
                            .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(PARALLEL_COMMANDS)))
                            .clone()
                    })
                    .map_err(|_| CodeError::fix("busy"))?;
                let _slot = slots
                    .acquire_owned()
                    .await
                    .map_err(|_| CodeError::fix("busy"))?;
                let timeout = request
                    .timeout_seconds
                    .map(Duration::from_secs)
                    .unwrap_or(exec::DEFAULT_TIMEOUT)
                    .clamp(Duration::from_secs(1), exec::MAX_TIMEOUT);
                exec::run(setup, timeout).await
            }
            "code.start" => {
                let request: processes::StartRequest = parse(input)?;
                let setup = self.setup(project, run_id, &request.cwd, &request.command).await?;
                self.checkpointed(project, run_id).await?;
                self.processes.start(&project.scope_id, &request, setup).await
            }
            "code.logs" => {
                let request: processes::ProcessRequest = parse(input)?;
                self.processes.logs(&project.scope_id, &request.id)
            }
            "code.processes" => Ok(self.processes.list(&project.scope_id)),
            "code.stop" => {
                let request: processes::ProcessRequest = parse(input)?;
                self.processes.stop(&project.scope_id, &request.id).await
            }
            "code.preview" => self.preview(project, input).await,
            _ => Err(CodeError::Scope(format!("unsupported operation {operation}"))),
        }
    }

    async fn checkpointed(&self, project: &Project, run_id: &str) -> Result<(), CodeError> {
        // Copying a project can take a moment; keep it off the async threads.
        tokio::task::block_in_place(|| self.ensure_checkpoint(project, run_id))
    }

    async fn preview(&self, project: &Project, input: Value) -> Result<Value, CodeError> {
        #[derive(serde::Deserialize)]
        struct PreviewRequest {
            #[serde(default)]
            path: String,
        }
        let request: PreviewRequest = parse(input)?;
        let relative = beneath::clean_relative(&request.path)?;
        if let Some(reason) = beneath::protected(&relative) {
            return Err(CodeError::fix(reason));
        }
        // A folder is served as the site's root (a build's dist/, say); a
        // file is served from the project's top folder.
        let root_path = project.root.clone();
        let probe = relative.clone();
        let is_dir = tokio::task::spawn_blocking(move || {
            beneath::open_root(&root_path)
                .and_then(|root| beneath::open_dir(&root, &probe))
                .is_ok()
        })
        .await
        .unwrap_or(false);
        let (site, page) = if is_dir {
            (relative.clone(), String::new())
        } else {
            (PathBuf::new(), relative.to_string_lossy().into_owned())
        };
        let (lookup_root, lookup_site, lookup_page) = (project.root.clone(), site.clone(), page.clone());
        let found = tokio::task::spawn_blocking(move || {
            crate::preview::resolve(&lookup_root, &lookup_site, &lookup_page)
        })
        .await
        .ok()
        .flatten();
        let Some((served, _)) = found else {
            return Err(CodeError::fix(if page.is_empty() {
                format!(
                    "There's no index.html in {}. Name the page to preview with path.",
                    if site.as_os_str().is_empty() { "the project's top folder".to_owned() } else { site.display().to_string() }
                )
            } else {
                format!("{page} can't be previewed: it doesn't exist, or it's hidden.")
            }));
        };
        let port = self
            .previews
            .serve(&project.scope_id, &project.root, &site)
            .await
            .map_err(|error| CodeError::Unavailable(format!("The preview server couldn't start: {error}")))?;
        let path = served.to_string_lossy().replace(' ', "%20");
        let path = path.strip_suffix("index.html").unwrap_or(&path).to_owned();
        Ok(json!({
            "url": format!("http://127.0.0.1:{port}/{path}"),
            "siteFolder": if site.as_os_str().is_empty() { ".".to_owned() } else { site.display().to_string() },
        }))
    }

    /// Runs that can be undone in a project.
    pub fn checkpoints(&self, scope_id: &str) -> Value {
        self.checkpoints.list(scope_id)
    }

    /// Restores a project to how it was before a run. Its processes stop
    /// first so nothing writes while files are put back.
    pub fn undo(&self, project: &Project, run_id: &str) -> Result<Value, CodeError> {
        self.check_root(&project.root)?;
        self.processes.stop_all(Some(&project.scope_id));
        self.checkpoints.undo(&project.scope_id, run_id, &project.root)
    }

    /// Stops everything for a project the person removed and forgets its undo
    /// copies, scratch folders and private home.
    pub fn forget(&self, scope_id: &str) {
        self.processes.stop_all(Some(scope_id));
        self.previews.stop(Some(scope_id));
        self.checkpoints.forget(scope_id);
        if scope_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') && !scope_id.is_empty() {
            let _ = std::fs::remove_dir_all(self.data.join("tmp").join(scope_id));
            let _ = std::fs::remove_dir_all(self.data.join("homes").join(scope_id));
        }
    }

    /// Stops every process and server (Misty is quitting).
    pub fn shutdown(&self) {
        self.processes.stop_all(None);
        self.previews.stop(None);
    }
}
