//! Which workspaces this machine follows and watches, and when its sign-in
//! lease is ready.
use super::*;

impl WorkspaceSync {
    /// Shows and edits `workspace` on this machine, without taking its lease (that
    /// follows activity). Returns the watch changes for the connection.
    pub fn open(&mut self, store: &mut Store, workspace: &str) -> Result<Vec<Outgoing>> {
        if !self
            .roster
            .iter()
            .any(|t| !t.shared && t.workspace_id == workspace)
        {
            return Err(Error::Invalid);
        }
        self.follow(store, Some(workspace.to_owned()))?;
        Ok(self.rewatch())
    }

    /// Aligns the watched set with `watch_targets`.
    pub(super) fn rewatch(&mut self) -> Vec<Outgoing> {
        let targets = self.watch_targets();
        let mut out = Vec::new();
        for workspace in self.watched.difference(&targets) {
            out.push(Outgoing::Unwatch {
                workspace_id: workspace.clone(),
            });
            self.current.remove(workspace);
        }
        for workspace in targets.difference(&self.watched) {
            out.push(self.watch(workspace));
        }
        self.watched = targets;
        out
    }

    /// Whether edits may be queued for the workspace this machine is on: it has a
    /// verified copy (current or cached) to replay them against. Publishing
    /// still waits until the copy is current on this connection.
    pub fn writable(&self) -> bool {
        self.on_workspace()
            .is_some_and(|workspace| self.states.contains_key(workspace))
    }

    /// Whether this machine may write the device's sign-in data: it holds the
    /// lease and its copy caught up with the server under that lease, so it
    /// never publishes over sign-ins written by the previous holder.
    pub(in crate::workspace) fn lease_ready(&self) -> bool {
        self.seat()
            .is_some_and(|seat| self.local.ready.as_ref() == Some(&seat))
    }

    /// Marks the driven workspace ready once the verified copy received on this
    /// connection is at least the version the server's roster reports.
    pub(super) fn refresh_ready(&mut self, store: &mut Store) -> Result<()> {
        let Some((workspace, epoch)) = self.seat() else {
            return Ok(());
        };
        if !self.roster_confirmed
            || !self.current.contains(&workspace)
            || self.local.ready.as_ref() == Some(&(workspace.clone(), epoch.clone()))
        {
            return Ok(());
        }
        let server = self
            .roster
            .iter()
            .find(|t| t.workspace_id == workspace)
            .map_or(0, |t| t.version);
        let local = self.states.get(&workspace).map_or(0, |s| s.version);
        if local < server {
            return Ok(());
        }
        let mut next = self.local.clone();
        next.ready = Some((workspace, epoch));
        store.set_workspace_local(&next)?;
        self.local = next;
        Ok(())
    }

    /// Drops this session's copy of a workspace so the next watch fetches the
    /// server's copy from scratch. A driven workspace is read-only until it has.
    pub fn forget(&mut self, store: &mut Store, workspace: &str) -> Result<()> {
        self.states.remove(workspace);
        self.current.remove(workspace);
        if self
            .local
            .ready
            .as_ref()
            .is_some_and(|(ready, _)| ready == workspace)
        {
            let mut next = self.local.clone();
            next.ready = None;
            store.set_workspace_local(&next)?;
            self.local = next;
        }
        Ok(())
    }

    pub(super) fn follow(&mut self, store: &mut Store, workspace: Option<String>) -> Result<()> {
        if self.local.following == workspace {
            return Ok(());
        }
        let mut next = self.local.clone();
        next.following = workspace;
        store.set_workspace_local(&next)?;
        self.local = next;
        Ok(())
    }

    /// Loads verified caches and the last roster, so the UI renders and edits
    /// keep queuing while offline; a cache that no longer verifies is dropped
    /// and refetched. Publishing still waits for fresh server state.
    pub fn load(&mut self, store: &Store, v: &Verifier<'_>) -> Result<()> {
        self.roster = store.workspace_roster()?;
        self.local = store.workspace_local()?;
        let mut cached = vec![self.shared_id.clone(), self.device_id.clone()];
        if let Some(driven) = self.driving() {
            cached.push(driven.to_owned());
        }
        if let Some(followed) = self.local.following.clone() {
            cached.push(followed);
        }
        cached.sort();
        cached.dedup();
        for workspace in cached {
            if let Some((snapshot, author)) = store.workspace_cache(v.root, &workspace)? {
                // The author's grant is vault-signed; verify it like any other.
                let mut grants = v.grants.clone();
                if let Some(grant) = author {
                    grants.entry(grant.device_id.clone()).or_insert(grant);
                }
                let offline = Verifier {
                    root: v.root,
                    scope: v.scope,
                    grants: &grants,
                };
                if let Ok(state) = WorkspaceState::from_snapshot(&offline, snapshot) {
                    self.states.insert(workspace, state);
                }
            }
        }
        for (request, op) in store.workspace_inflight()? {
            self.inflight.insert(
                op.workspace_id.clone(),
                (request, op, Instant::now(), Carried::default()),
            );
        }
        Ok(())
    }

    /// Once every device keeps bookmarks in collections, nothing
    /// reads or writes the shared workspace: it is no longer watched or published.
    pub fn retire_shared(&mut self, retired: bool) -> Vec<Outgoing> {
        if self.shared_retired == retired {
            return Vec::new();
        }
        self.shared_retired = retired;
        self.rewatch()
    }

    /// Workspaces kept current on the connection: the shared workspace (until it
    /// retires) and the workspace this machine is on (with or without its lease).
    pub(super) fn watch_targets(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        if !self.shared_retired {
            out.insert(self.shared_id.clone());
        }
        if let Some(workspace) = self.on_workspace() {
            out.insert(workspace.to_owned());
        }
        out
    }

    /// Workspaces this machine publishes to: the shared workspace and the workspace it is
    /// on. `tick` publishes each only once its copy is current.
    pub(super) fn publish_targets(&self) -> BTreeSet<String> {
        self.watch_targets()
    }

    pub(super) fn watch(&self, workspace: &str) -> Outgoing {
        Outgoing::Watch {
            workspace_id: workspace.to_owned(),
            after: self.states.get(workspace).map_or(0, |s| s.version),
        }
    }

    /// A fresh connection re-watches and resends in-flight ops verbatim, so
    /// a lost acknowledgment is resolved by the server's receipt.
    pub fn on_connect(&mut self) -> Vec<Outgoing> {
        self.roster_confirmed = false;
        self.current.clear();
        self.watched.clear();
        let mut out = Vec::new();
        for workspace in self.watch_targets() {
            out.push(self.watch(&workspace));
            self.watched.insert(workspace);
        }
        for (request, op, sent, _) in self.inflight.values_mut() {
            *sent = Instant::now();
            out.push(Outgoing::Publish {
                request_id: request.clone(),
                op: op.clone(),
            });
        }
        out
    }
}
