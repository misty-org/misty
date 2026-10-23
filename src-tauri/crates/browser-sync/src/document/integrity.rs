//! Whole-document validation and orphan detection.
use super::*;

impl Document {
    pub fn validate(&self) -> Result<()> {
        if self.active_device.as_ref().is_some_and(|v| {
            !crate::protocol::valid_id(&v.epoch)
                || v.sequence == 0
                || v.sequence > self.sequence
                || v.device_id
                    .as_deref()
                    .is_some_and(|id| !crate::protocol::valid_id(id))
        }) {
            return Err(Error::Invalid);
        }
        if self.version != 1
            || self.sequence > MAX_COUNTER
            || self.records.len() > 50_000
            || self.credentials.len() > 10_000
            || self.resumes.len() > 1024
            || self.rejected_credentials_by_device.len() > 1024
        {
            return Err(Error::Invalid);
        }
        for (key, record) in &self.records {
            if *key != record.kind.key(&record.id)?
                || record.created_sequence > self.sequence
                || record
                    .deleted_sequence
                    .is_some_and(|s| s == 0 || s > self.sequence)
                || record
                    .fields
                    .values()
                    .any(|f| f.sequence == 0 || f.sequence > self.sequence)
            {
                return Err(Error::Invalid);
            }
            if record.deleted_sequence.is_none() {
                if record.created_sequence == 0 {
                    return Err(Error::Invalid);
                }
                entities::validate(record.kind, &record.values())?;
            }
        }
        for (key, record) in &self.credentials {
            if record.sequence == 0
                || record.sequence > self.sequence
                || *key != record.area.key(&record.profile_id)?
            {
                return Err(Error::Invalid);
            }
            record.area.validate_payload(&record.payload)?;
        }
        for (device, record) in &self.resumes {
            if !crate::protocol::valid_id(device)
                || record.sequence == 0
                || record.sequence > self.sequence
            {
                return Err(Error::Invalid);
            }
            record.resume.validate()?;
        }
        for (device, rejected) in &self.rejected_credentials_by_device {
            if !crate::protocol::valid_id(device)
                || !crate::protocol::valid_id(&rejected.operation_id)
                || rejected.sequence == 0
                || rejected.sequence > self.sequence
                || rejected.areas.is_empty()
                || rejected.areas.len() > 128
            {
                return Err(Error::Invalid);
            }
            for area in &rejected.areas {
                area.key(&rejected.profile_id)?;
            }
        }
        Ok(())
    }

    /// Projection must expose these views in deterministic recovery layouts.
    /// Concurrent workspace/container changes never implicitly delete a tab record.
    pub fn orphaned_views(&self) -> Result<Vec<String>> {
        let mut orphaned = Vec::new();
        for record in self
            .records
            .values()
            .filter(|r| r.kind == Kind::View && r.deleted_sequence.is_none())
        {
            let view: entities::View =
                serde_json::from_value(serde_json::to_value(record.values())?)?;
            let valid = if let Some(tab) = self.live(Kind::Tab, &view.placement.tab_id) {
                let tab: entities::Tab =
                    serde_json::from_value(serde_json::to_value(tab.values())?)?;
                self.live(Kind::Window, &tab.window_id).is_some()
                    && tab.tree.panes()?.contains(&view.placement.pane_id)
            } else {
                false
            };
            if !valid {
                orphaned.push(record.id.clone());
            }
        }
        Ok(orphaned)
    }
}
