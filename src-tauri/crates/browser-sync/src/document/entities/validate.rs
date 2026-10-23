//! Field validation for every synced entity kind.
use super::*;

pub fn validate(kind: Kind, fields: &Fields) -> Result<()> {
    let value = serde_json::to_value(fields)?;
    match kind {
        Kind::Folder => {
            let v: Folder = serde_json::from_value(value)?;
            text(&v.label, 160, false)?;
            group_icon(&v.icon)?;
            order(v.order)?;
            if v.parent_id.as_deref().is_some_and(|id| !valid_id(id)) {
                return Err(Error::Invalid);
            }
            added_at(v.added_at)?;
        }
        Kind::Bookmark => {
            let v: Bookmark = serde_json::from_value(value)?;
            if !valid_id(&v.folder_id) {
                return Err(Error::Invalid);
            }
            text(&v.title, 512, false)?;
            web_url(&v.url)?;
            order(v.order)?;
            added_at(v.added_at)?;
        }
        Kind::Window => {
            let v: Window = serde_json::from_value(value)?;
            text(&v.title, 160, true)?;
            order(v.order)?;
        }
        Kind::Tab => {
            let v: Tab = serde_json::from_value(value)?;
            if !valid_id(&v.window_id) {
                return Err(Error::Invalid);
            }
            text(&v.title, 512, true)?;
            order(v.order)?;
            v.tree.panes()?;
            if let Some(url) = &v.pinned_url {
                web_url(url)?;
            }
        }
        Kind::TabGroup => {
            let v: TabGroup = serde_json::from_value(value)?;
            text(&v.name, 160, true)?;
            if !TAB_GROUP_COLORS.contains(&v.color.as_str())
                || v.tab_ids.len() > 1024
                || v.tab_ids.iter().any(|id| !valid_id(id))
            {
                return Err(Error::Invalid);
            }
            order(v.order)?;
        }
        Kind::SavedTabGroup => {
            let v: SavedTabGroup = serde_json::from_value(value)?;
            text(&v.name, 160, true)?;
            if !TAB_GROUP_COLORS.contains(&v.color.as_str())
                || v.tabs.len() > 48 << 10
                || serde_json::from_str::<Value>(&v.tabs).map_or(true, |l| !l.is_array())
            {
                return Err(Error::Invalid);
            }
            order(v.order)?;
        }
        Kind::Login => {
            let v: Login = serde_json::from_value(value)?;
            login_origin(&v.origin)?;
            if v.username.len() > 512
                || v.password.is_empty()
                || v.password.len() > 4096
                || v.username.contains('\0')
                || v.password.contains('\0')
            {
                return Err(Error::Invalid);
            }
            added_at(Some(v.created_at))?;
            added_at(Some(v.updated_at))?;
        }
        Kind::SpaceSites => {
            let v: SpaceSites = serde_json::from_value(value)?;
            let unique: BTreeSet<&str> = v.hosts.iter().map(String::as_str).collect();
            if v.hosts.len() > MAX_SPACE_SITES
                || unique.len() != v.hosts.len()
                || !v.hosts.iter().all(|host| site_host(host))
            {
                return Err(Error::Invalid);
            }
        }
        Kind::Extension => {
            let v: Extension = serde_json::from_value(value)?;
            if !valid_id(&v.store_id) || v.store_id.len() > 64 || v.version.len() > 64 {
                return Err(Error::Invalid);
            }
            text(&v.name, 256, true)?;
            text(&v.version, 64, true)?;
            added_at(Some(v.updated_at))?;
        }
        Kind::SitePermission => {
            let v: SitePermission = serde_json::from_value(value)?;
            login_origin(&v.origin)?;
            added_at(Some(v.updated_at))?;
        }
        Kind::SearchDefault => {
            let v: SearchDefault = serde_json::from_value(value)?;
            if !valid_id(&v.engine) {
                return Err(Error::Invalid);
            }
        }
        Kind::SearchEngine => {
            let v: SearchEngine = serde_json::from_value(value)?;
            text(&v.name, 60, false)?;
            search_template(&v.search)?;
            order(v.order)?;
        }
        Kind::SearchBang => {
            let v: SearchBang = serde_json::from_value(value)?;
            if !bang_trigger(&v.trigger) {
                return Err(Error::Invalid);
            }
            text(&v.name, 60, false)?;
            search_template(&v.url)?;
            order(v.order)?;
        }
        Kind::Download => {
            let v: Download = serde_json::from_value(value)?;
            web_url(&v.url)?;
            text(&v.file_name, 1024, false)?;
            if v.file_name.contains(['/', '\\']) || !valid_id(&v.device_id) {
                return Err(Error::Invalid);
            }
            added_at(Some(v.finished_at))?;
        }
        Kind::ExtensionRemoval => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Removed {
                extension: String,
                generation: String,
            }
            let v: Removed = serde_json::from_value(value)?;
            if v.extension.is_empty()
                || v.extension.len() > 256
                || uuid::Uuid::parse_str(&v.generation).is_err()
            {
                return Err(Error::Invalid);
            }
        }
        Kind::ExtensionSyncKey => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct ExtensionValue {
                extension: String,
                generation: String,
                key: String,
                change: Value,
            }
            let v: ExtensionValue = serde_json::from_value(value)?;
            if v.extension.is_empty()
                || v.extension.len() > 256
                || !valid_id(&v.generation)
                || v.key.len() > 8192
                || serde_json::to_vec(&v.change)?.len() + v.key.len() > 8192
                || !v.change.as_object().is_some_and(|change| {
                    change.len() == 1
                        && (change.get("deleted") == Some(&Value::Bool(true))
                            || change.contains_key("value"))
                })
            {
                return Err(Error::Invalid);
            }
        }
        Kind::HistoryBatch => {
            let v: HistoryBatch = serde_json::from_value(value)?;
            if !valid_id(&v.origin) || v.hour < 0 || v.part > 64 || v.visits.len() > 2000 {
                return Err(Error::Invalid);
            }
            for visit in &v.visits {
                web_url(&visit.url)?;
                text(&visit.title, 512, true)?;
                if visit.visited_at / 3_600_000 != v.hour {
                    return Err(Error::Invalid);
                }
            }
        }
        Kind::View => {
            let v: View = serde_json::from_value(value)?;
            text(&v.title, 2048, true)?;
            order(v.placement.order)?;
            if !valid_id(&v.placement.tab_id)
                || !valid_id(&v.placement.pane_id)
                || v.bookmark_id.as_ref().is_some_and(|id| !valid_id(id))
            {
                return Err(Error::Invalid);
            }
            match v.surface {
                Surface::Browser => {
                    let url = v.url.as_deref().ok_or(Error::Invalid)?;
                    if url != "about:blank" {
                        let extension = url::Url::parse(url).is_ok_and(|u| {
                            u.scheme() == "webkit-extension"
                                && u.username().is_empty()
                                && u.password().is_none()
                                && u.port().is_none()
                                && u.host_str()
                                    .is_some_and(|host| uuid::Uuid::parse_str(host).is_ok())
                        });
                        if !extension {
                            web_url(url)?;
                        }
                    }
                    if !v.profile_id.as_deref().is_some_and(profile_id) || v.tool_route.is_some() {
                        return Err(Error::Invalid);
                    }
                }
                Surface::Home
                | Surface::Files
                | Surface::Agents
                | Surface::Space
                | Surface::Extensions => {
                    if v.url.is_some() || v.profile_id.is_some() || v.bookmark_id.is_some() {
                        return Err(Error::Invalid);
                    }
                    let route = v.tool_route.as_deref().ok_or(Error::Invalid)?;
                    text(route, 4096, false)?;
                    let path = route.split(['?', '#']).next().unwrap_or_default();
                    let prefix = match v.surface {
                        Surface::Home => "/home",
                        Surface::Files => "/files",
                        Surface::Space => "/spaces",
                        Surface::Extensions => "/extensions",
                        _ => "/agents",
                    };
                    if path != prefix && !path.starts_with(&format!("{prefix}/")) {
                        return Err(Error::Invalid);
                    }
                }
            }
        }
    }
    Ok(())
}
