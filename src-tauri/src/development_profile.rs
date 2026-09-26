//! Keep debug profile storage tied to the launched profile, even when Cargo's
//! shared output was last compiled for another development profile.
use std::path::Path;

fn valid(profile: &str) -> bool {
    !profile.is_empty()
        && profile.len() <= 32
        && profile
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn bundle_profile(executable: &Path) -> Option<&str> {
    let bundle = executable.parent()?.parent()?.parent()?;
    if bundle.parent()?.file_name()? != "misty-dev-apps" {
        return None;
    }
    let name = bundle.file_name()?.to_str()?.strip_suffix(".app")?;
    (name != "Misty").then_some(name)
}

fn select<'a>(
    profile: Option<&'a str>,
    desktop: Option<&'a str>,
    bundle: Option<&'a str>,
) -> Result<Option<&'a str>, &'static str> {
    let selected = profile.or(desktop).or(bundle);
    for candidate in [profile, desktop, bundle].into_iter().flatten() {
        if !valid(candidate) || Some(candidate) != selected {
            return Err("Development profile identifiers disagree or are invalid");
        }
    }
    Ok(selected)
}

pub fn configure(context: &mut tauri::Context<tauri::Wry>) -> Result<(), &'static str> {
    let profile = std::env::var("MISTY_PROFILE").ok();
    let desktop = std::env::var("MISTY_DESKTOP_PROFILE").ok();
    let executable = std::env::current_exe().map_err(|_| "Development executable unavailable")?;
    let Some(profile) = select(
        profile.as_deref(),
        desktop.as_deref(),
        bundle_profile(&executable),
    )?
    else {
        return Ok(());
    };
    // Set both before any plugin/credential client starts. Tauri uses its
    // context identifier for storage and single-instance handling, not the
    // bundle's display name or Info.plist identifier.
    std::env::set_var("MISTY_PROFILE", profile);
    std::env::set_var("MISTY_DESKTOP_PROFILE", profile);
    context.config_mut().identifier = format!("com.misty.desktop.{profile}");
    context.config_mut().product_name = Some(format!("Misty {profile}"));
    if let Ok(port) = std::env::var("MISTY_DESKTOP_DEV_PORT") {
        let port = port
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or("Invalid development server port")?;
        let mut url = context
            .config()
            .build
            .dev_url
            .clone()
            .ok_or("Development server URL unavailable")?;
        url.set_port(Some(port))
            .map_err(|_| "Invalid development server URL")?;
        context.config_mut().build.dev_url = Some(url);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_profiles_survive_missing_launcher_environment() {
        for profile in ["dev1", "dev2"] {
            let path = format!("/build/misty-dev-apps/{profile}.app/Contents/MacOS/misty-desktop");
            assert_eq!(
                select(None, None, bundle_profile(Path::new(&path))).unwrap(),
                Some(profile)
            );
        }
        assert_eq!(
            bundle_profile(Path::new(
                "/Applications/Misty.app/Contents/MacOS/misty-desktop"
            )),
            None
        );
        assert_eq!(select(None, None, None).unwrap(), None);
    }

    #[test]
    fn credentials_and_tauri_must_select_the_same_development_profile() {
        assert_eq!(
            select(Some("dev1"), Some("dev1"), Some("dev1")).unwrap(),
            Some("dev1")
        );
        assert!(select(Some("dev1"), Some("dev2"), None).is_err());
        assert!(select(Some("dev1"), None, Some("dev2")).is_err());
        assert!(select(Some("../production"), None, None).is_err());
    }
}
