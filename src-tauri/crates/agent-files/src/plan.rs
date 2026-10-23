//! Validating a proposed reorganization into a manifest before any effect.
use super::*;

impl Organizer {
    pub fn prepare(
        &self,
        account: &str,
        grant_id: &str,
        plan_id: &str,
        steps: Vec<Step>,
    ) -> Result<Manifest> {
        Uuid::parse_str(plan_id).map_err(err)?;
        let (grant, root) = self.scope(account, grant_id)?;
        if self.manifest_document(plan_id)?.is_some() {
            let existing = self.manifest(account, plan_id)?;
            if existing.grant_id != grant_id || existing.steps != steps {
                return Err("Plan identity was reused with different operations".into());
            }
            return Ok(existing);
        }
        if steps.is_empty() || steps.len() > 100 {
            return Err("A plan must contain 1–100 operations".into());
        }
        let mut sources = HashSet::new();
        let mut destinations = HashSet::new();
        let mut created = HashSet::new();
        let mut receipts = vec![];
        for (index, step) in steps.iter().enumerate() {
            let (destination, source) = match step {
                Step::Move {
                    source_id,
                    destination,
                } => (destination, Some(source_id)),
                Step::Mkdir { destination } => (destination, None),
            };
            let names = parts(destination)?;
            if !destinations.insert(destination.to_lowercase()) {
                return Err("Duplicate destination in the proposal".into());
            }
            let parent_path = names[..names.len() - 1].join("/");
            if !parent_path.is_empty() && !created.contains(&parent_path) {
                let dir = open_item(&root, &parent_path)?;
                if !dir.metadata().map_err(err)?.is_dir() {
                    return Err("Destination parent is not a folder".into());
                }
            }
            if let Ok((dir, name)) = parent(&root, destination) {
                absent(&dir, &name)?;
            }
            let (from, fp) = if let Some(id) = source {
                if !sources.insert(id) {
                    return Err("A source can only move once in a plan".into());
                }
                let item = grant
                    .snapshot
                    .items
                    .iter()
                    .find(|i| &i.id == id && !i.directory)
                    .ok_or("Source is not a granted regular file")?;
                let current = open_item(&root, &item.relative_path)?;
                if !current.metadata().map_err(err)?.is_file()
                    || fingerprint(&current)? != item.fingerprint
                {
                    return Err("A source changed after planning; refresh the proposal".into());
                }
                (
                    Some(item.relative_path.clone()),
                    Some(item.fingerprint.clone()),
                )
            } else {
                created.insert(destination.clone());
                (None, None)
            };
            receipts.push(Receipt {
                index,
                from,
                to: destination.clone(),
                state: "pending".into(),
                error: None,
                fingerprint: fp,
            });
        }
        let manifest = Manifest {
            id: plan_id.into(),
            grant_id: grant_id.into(),
            state: "prepared".into(),
            receipts,
            steps,
        };
        self.save(plan_id, "manifest", &manifest)?;
        Ok(manifest)
    }
}
