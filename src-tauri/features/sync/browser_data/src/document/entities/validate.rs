//! Field validation for every synced entity kind.
use super::*;

pub fn validate(kind: Kind, fields: &Fields) -> Result<()> {
    let value = serde_json::to_value(fields)?;
    match kind {
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
        // Their shape is the client's own business: a record that can't be read is ignored by what
        // reads it, and nothing here can hold up the others.
        Kind::OpenTab => {}
        Kind::Download => {
            let v: Download = serde_json::from_value(value)?;
            web_url(&v.url)?;
            text(&v.file_name, 1024, false)?;
            if v.file_name.contains(['/', '\\']) || !valid_id(&v.device_id) {
                return Err(Error::Invalid);
            }
            added_at(Some(v.finished_at))?;
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
