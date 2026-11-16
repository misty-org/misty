//! The studio's music player: one page of a music service's own website (YouTube Music, Spotify,
//! Apple Music or SoundCloud), which the person signs in to and plays themselves. It is not an
//! agent page: it has no Kiri scripts, no agent hooks and, under its own label, no Misty commands
//! (`tauri-permissions/capabilities`), and it keeps its sign-ins in a website data store of its
//! own, so signing in to a music service never signs any agent page in. Its one script only
//! remembers the page's own media controls, which the studio's player card reads and presses
//! (`studio_music_media.rs`). It stays on its service's site and sign-in pages; a link that opens
//! a new window goes to the system browser. Hidden, it is only moved out of sight, so the music
//! keeps playing; closing it ends it.

use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::{
    utils::config::{BackgroundThrottlingPolicy, WebviewUrl},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder,
};
use url::Url;

use crate::browser::app_windows;
use crate::browser::site_data::profile_store::webkit_store_identifier;
use crate::browser::site_data::store_data::with_store_data;

/// The player's one webview. Not `misty-browser-*`, so no capability reaches it.
pub(crate) const LABEL: &str = "misty-music";

/// Where a hidden player waits: in the window, out of sight, still playing.
fn parked() -> LogicalPosition<f64> {
    LogicalPosition::new(-32_000.0, -32_000.0)
}

/// A music service: its id, the page the player opens on, its own sites, and the sign-in pages
/// it sends people to (kept from the provider list Misty's app pages used).
struct Service {
    id: &'static str,
    home: &'static str,
    sites: &'static [&'static str],
    sign_in: &'static [&'static str],
}

const SERVICES: &[Service] = &[
    Service {
        id: "youtube-music",
        home: "https://music.youtube.com/",
        sites: &["music.youtube.com", "youtube.com"],
        sign_in: &["accounts.google.com", "accounts.youtube.com"],
    },
    Service {
        id: "spotify",
        home: "https://open.spotify.com/",
        sites: &["open.spotify.com", "spotify.com"],
        sign_in: &[
            "accounts.spotify.com",
            "accounts.google.com",
            "appleid.apple.com",
            "facebook.com",
        ],
    },
    Service {
        id: "apple-music",
        home: "https://music.apple.com/",
        sites: &["music.apple.com"],
        sign_in: &["idmsa.apple.com", "appleid.apple.com", "account.apple.com"],
    },
    Service {
        id: "soundcloud",
        home: "https://soundcloud.com/",
        sites: &["soundcloud.com"],
        sign_in: &["accounts.google.com", "appleid.apple.com", "facebook.com"],
    },
];

/// Pages the services' sign-ins lean on, matched exactly (not their subdomains): Google's bot
/// check and its cookie-consent page. Navigation here also covers frames inside the page, so
/// leaving these out would break signing in.
const HELPERS: &[&str] = &["www.google.com", "www.recaptcha.net", "consent.google.com"];

fn service(id: &str) -> Option<&'static Service> {
    SERVICES.iter().find(|service| service.id == id)
}

/// Whether the player may go to `url` while it plays `service`: its sites and sign-in pages,
/// over plain https on the usual port, with nothing tucked into the address.
fn allows(service: &Service, url: &Url) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let under = |domain: &&str| host == *domain || host.ends_with(&format!(".{domain}"));
    service.sites.iter().any(under)
        || service.sign_in.iter().any(under)
        || HELPERS.contains(&host)
}

/// The service the player is on now, read by its navigation rules.
fn playing() -> &'static Mutex<&'static str> {
    static PLAYING: OnceLock<Mutex<&'static str>> = OnceLock::new();
    PLAYING.get_or_init(|| Mutex::new(SERVICES[0].id))
}

fn now_playing() -> &'static Service {
    let id = *playing().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    service(id).unwrap_or(&SERVICES[0])
}

/// The music player's own website data store, apart from the profile's pages but kept per
/// profile: a 64-character identity worked out from the profile's store.
fn music_store(profile_store: Option<&str>) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"misty-studio-music\0");
    hash.update(profile_store.unwrap_or("default").as_bytes());
    hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl MusicBounds {
    fn logical(&self) -> (LogicalPosition<f64>, LogicalSize<f64>) {
        (
            LogicalPosition::new(self.x.max(0.0), self.y.max(0.0)),
            LogicalSize::new(self.width.max(1.0), self.height.max(1.0)),
        )
    }
}

/// Where the player should be, and whether its page has drawn yet. A page that hasn't drawn
/// waits out of sight, so the studio never shows its blank first frame, the way an agent's page
/// keeps the last one until the new page paints (`pages/first_paint.rs`).
#[derive(Default)]
struct Sight {
    /// Over the panel's frame, or `None` out of sight.
    wanted: Option<(LogicalPosition<f64>, LogicalSize<f64>)>,
    painted: bool,
    /// Counts the loads held, so a timeout for an earlier one doesn't reveal a later one.
    load: u64,
}

fn sight() -> &'static Mutex<Sight> {
    static SIGHT: OnceLock<Mutex<Sight>> = OnceLock::new();
    SIGHT.get_or_init(Mutex::default)
}

fn with_sight<T>(change: impl FnOnce(&mut Sight) -> T) -> T {
    change(&mut sight().lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

/// A page that never says it has finished still appears after this long.
const PAINT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(4);

/// Puts the player where it should be now: over its frame once its page has drawn, otherwise
/// out of sight, still playing.
fn settle(webview: &Webview) -> Result<(), String> {
    let wanted = with_sight(|sight| sight.wanted.filter(|_| sight.painted));
    match wanted {
        Some((position, size)) => {
            webview
                .set_bounds(tauri::Rect {
                    position: position.into(),
                    size: size.into(),
                })
                .map_err(|error| error.to_string())?;
            // Back from out of sight, it comes in front of the window's own page again.
            crate::browser::present_macos_webview(webview)
        }
        None => webview.set_position(parked()).map_err(|error| error.to_string()),
    }
}

/// Holds the player out of sight until the page now loading has drawn.
fn hold(app: &AppHandle) {
    let load = with_sight(|sight| {
        sight.painted = false;
        sight.load += 1;
        sight.load
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(PAINT_TIMEOUT).await;
        if with_sight(|sight| sight.load == load && !sight.painted) {
            painted(&app);
        }
    });
}

/// The page has drawn: the player may show.
fn painted(app: &AppHandle) {
    with_sight(|sight| sight.painted = true);
    if let Some(player) = app.get_webview(LABEL) {
        let _ = settle(&player);
    }
}

/// A link that wants a new window: one on the service's own sites opens in the player, anything
/// else in the system browser.
fn new_window(app: &AppHandle, url: Url) -> NewWindowResponse<tauri::Wry> {
    if allows(now_playing(), &url) {
        if let Some(player) = app.get_webview(LABEL) {
            let _ = player.navigate(url);
        }
    } else if matches!(url.scheme(), "http" | "https") {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    NewWindowResponse::Deny
}

/// Opens the player on `service` over `bounds`, or brings it back there. Switching service sends
/// the open player to the new one's home page.
#[tauri::command]
pub async fn studio_music_open(
    caller: Webview,
    app: AppHandle,
    service: String,
    bounds: MusicBounds,
) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    let chosen = self::service(&service).ok_or("That music service isn't one Misty knows.")?;
    // The panel asks again on every frame it moves while opening; one open at a time, so a later
    // ask finds the player the first one made instead of building it again.
    static OPENING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _opening = OPENING.lock().await;
    let switched = {
        let mut current = playing().lock().map_err(|_| "The player is unavailable.")?;
        let switched = *current != chosen.id;
        *current = chosen.id;
        switched
    };
    let home = Url::parse(chosen.home).map_err(|error| error.to_string())?;
    with_sight(|sight| sight.wanted = Some(bounds.logical()));
    if let Some(player) = app.get_webview(LABEL) {
        if switched {
            // The new service's page is held like the first one, so its blank frame never shows.
            hold(&app);
            player.navigate(home).map_err(|error| error.to_string())?;
        }
        return settle(&player);
    }

    let owner = caller.window().label().to_owned();
    let profile =
        app_windows::profile_for_owner(&owner).ok_or("Only a profile's window can play music.")?;
    let page_store = step("store lease", crate::browser::profiles::page_store(&profile).await)?;
    let store = music_store(page_store.store.as_deref());
    let popup_app = app.clone();
    let paint_app = app.clone();
    let builder = step(
        "store folder",
        with_store_data(
            WebviewBuilder::new(LABEL, WebviewUrl::External(home))
                // Out of sight it keeps playing, at full speed.
                .background_throttling(BackgroundThrottlingPolicy::Disabled),
            &app,
            Some(&store),
        ),
    )?
    .data_store_identifier(webkit_store_identifier(Some(&store))?)
    .focused(false)
    .accept_first_mouse(true)
    // Remembers the page's own media controls, for the player card (`studio_music_media.rs`).
    .initialization_script(crate::browser::studio_music_media::MEDIA_HOOKS)
    // Includes frames and redirects: anything off the service's sites is simply not loaded.
    .on_navigation(|url| allows(now_playing(), url))
    .on_new_window(move |url, _features| new_window(&popup_app, url))
    .on_page_load(move |_, payload| {
        if payload.event() == PageLoadEvent::Finished {
            painted(&paint_app);
        }
    });
    // Sites such as Google serve their old pages to a bare WebKit; it goes as desktop Safari.
    let builder = match crate::browser::native_macos_safari_user_agent() {
        Some(agent) => builder.user_agent(&agent),
        None => builder,
    };
    step("main view", crate::browser::remember_main_macos_webview(&app, &owner))?;
    let (_, size) = bounds.logical();
    hold(&app);
    // Made out of sight; it comes over the panel once its page has drawn.
    let player = step(
        "add view",
        caller
            .window()
            .add_child(builder, parked(), size)
            .map_err(|error| error.to_string()),
    )?;
    drop(page_store);
    settle(&player)
}

/// Development builds say in the terminal which step of opening the player failed.
fn step<T>(name: &str, result: Result<T, String>) -> Result<T, String> {
    #[cfg(debug_assertions)]
    if let Err(error) = &result {
        eprintln!("[studio music] {name} failed: {error}");
    }
    #[cfg(not(debug_assertions))]
    let _ = name;
    result
}

/// Moves the open player to follow its panel.
#[tauri::command]
pub fn studio_music_place(caller: Webview, app: AppHandle, bounds: MusicBounds) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    with_sight(|sight| sight.wanted = Some(bounds.logical()));
    match app.get_webview(LABEL) {
        Some(player) => settle(&player),
        None => Ok(()),
    }
}

/// Puts the player out of sight; what it plays goes on.
#[tauri::command]
pub fn studio_music_hide(caller: Webview, app: AppHandle) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    with_sight(|sight| sight.wanted = None);
    match app.get_webview(LABEL) {
        Some(player) => settle(&player),
        None => Ok(()),
    }
}

/// Closes the player, and with it the music.
#[tauri::command]
pub fn studio_music_close(caller: Webview, app: AppHandle) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    match app.get_webview(LABEL) {
        // As a closed tab: silenced and out of sight first, then closed with its page process,
        // which `close` alone leaves running and on screen.
        Some(player) => {
            with_sight(|sight| *sight = Sight::default());
            crate::browser::studio_music_media::forget();
            crate::browser::silence_page(&player);
            crate::browser::close_page(&player)
        }
        None => Ok(()),
    }
}

/// Whether the player is open, playing or out of sight, and on which service.
#[tauri::command]
pub fn studio_music_state(caller: Webview, app: AppHandle) -> Result<Option<String>, String> {
    crate::project::person_window(&caller)?;
    Ok(app.get_webview(LABEL).map(|_| now_playing().id.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_player_stays_on_its_service_and_its_sign_in() {
        let youtube = service("youtube-music").unwrap();
        for ok in [
            "https://music.youtube.com/watch?v=x",
            "https://consent.youtube.com/m",
            "https://accounts.google.com/ServiceLogin",
            "https://www.google.com/recaptcha/api2/anchor",
        ] {
            assert!(allows(youtube, &Url::parse(ok).unwrap()), "{ok}");
        }
        for refused in [
            "https://open.spotify.com/",
            "http://music.youtube.com/",
            "https://music.youtube.com:8443/",
            "https://user@music.youtube.com/",
            "https://evilyoutube.com/",
            "https://mail.google.com/",
            "file:///etc/passwd",
        ] {
            assert!(!allows(youtube, &Url::parse(refused).unwrap()), "{refused}");
        }
        let spotify = service("spotify").unwrap();
        assert!(allows(spotify, &Url::parse("https://accounts.spotify.com/login").unwrap()));
        assert!(!allows(spotify, &Url::parse("https://music.youtube.com/").unwrap()));
    }

    #[test]
    fn the_music_store_is_its_own_and_valid() {
        let store = music_store(None);
        assert_eq!(store.len(), 64);
        assert!(crate::browser::site_data::profile_store::data_store_identifier(Some(&store)).is_ok());
        assert_ne!(music_store(None), music_store(Some(&"a".repeat(64))));
    }
}
