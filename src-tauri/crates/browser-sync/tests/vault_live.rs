//! The real client against the real server: its handlers, socket and Postgres. The server's
//! contract test `TestRustClientAgainstRealServer` starts one and runs this with
//! MISTY_VAULT_LIVE_URL and a login for one fresh account; without them it does nothing.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot},
    document::{entities::Kind, ViewRecord},
    local::{LocalKey, LocalStore},
    transport::SyncApi,
    vault::{
        client::SessionInfo,
        exchange::Notice,
        keys,
        link::{Link, LinkConfig, LinkStatus},
    },
    Error,
};
use serde_json::json;

const P: &str = "personal";
const C: &str = "bookmarks";
const PASSWORD: &str = "Correct1!horse";

fn api(url: &str, token: &str) -> SyncApi {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    SyncApi::new(
        url,
        reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap(),
    )
    .unwrap()
}

/// One signed-in install: its own database, keys and link.
struct Session {
    _directory: tempfile::TempDir,
    api: SyncApi,
    store: Arc<Mutex<LocalStore>>,
    session_id: String,
    key: DeviceKey,
    link: Option<Link>,
    root: Option<VaultRoot>,
    vault_id: String,
}

impl Session {
    fn new(url: &str, token: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("r.sqlite"), &LocalKey::generate())
            .unwrap();
        Self {
            _directory: directory,
            api: api(url, token),
            store: Arc::new(Mutex::new(store)),
            session_id: uuid::Uuid::new_v4().to_string(),
            key: DeviceKey::generate(),
            link: None,
            root: None,
            vault_id: String::new(),
        }
    }

    fn info(name: &str) -> SessionInfo {
        SessionInfo {
            name: name.into(),
            platform: "test".into(),
            os_version: "1".into(),
        }
    }

    async fn create(&mut self, name: &str) {
        let root = VaultRoot::generate();
        let vault_id = uuid::Uuid::new_v4().to_string();
        let envelope = keys::seal_root(&root, &vault_id, PASSWORD).unwrap();
        self.api
            .create_server_vault(
                &root,
                &vault_id,
                &envelope,
                &self.session_id,
                &self.key,
                &Self::info(name),
            )
            .await
            .unwrap();
        self.root = Some(root);
        self.vault_id = vault_id;
    }

    async fn join(&mut self, password: &str, name: &str) -> Result<(), Error> {
        let vault = self.api.server_vault().await?.expect("the vault exists");
        let root = keys::open_root(
            &vault.key_envelope,
            &vault.vault_id,
            password,
            &vault.root_public_key,
        )?;
        self.api
            .enroll_session(
                &root,
                &vault.vault_id,
                &self.session_id,
                &self.key,
                &Self::info(name),
            )
            .await?;
        self.root = Some(root);
        self.vault_id = vault.vault_id;
        Ok(())
    }

    fn start(&mut self) {
        self.link = Some(
            Link::start(LinkConfig {
                api: self.api.clone(),
                store: self.store.clone(),
                root: self.root.as_ref().unwrap().duplicate(),
                vault_id: self.vault_id.clone(),
                session_id: self.session_id.clone(),
                session_key: self.key.clone(),
                on_change: Arc::new(|_, _| {}),
                on_sessions: Arc::new(|| {}),
            })
            .unwrap(),
        );
    }

    async fn pause(&mut self) {
        if let Some(link) = self.link.take() {
            link.shutdown().await;
        }
    }

    fn edit(&self, id: &str, title: Option<&str>) {
        let record = title.map(|title| ViewRecord {
            kind: Kind::Bookmark,
            id: id.into(),
            fields: serde_json::from_value(json!({ "title": title })).unwrap(),
        });
        self.store
            .lock()
            .unwrap()
            .write(P, C, vec![(id.into(), record)])
            .unwrap();
        if let Some(link) = &self.link {
            link.edited();
        }
    }

    fn title(&self, id: &str) -> Option<String> {
        self.store
            .lock()
            .unwrap()
            .get(P, C, id)
            .unwrap()
            .map(|record| record.fields["title"].as_str().unwrap().to_owned())
    }

    fn status(&self) -> LinkStatus {
        self.link.as_ref().unwrap().status.borrow().clone()
    }

    async fn until(&self, what: &str, within: Duration, check: impl Fn(&Self) -> bool) -> Duration {
        let start = Instant::now();
        while !check(self) {
            assert!(start.elapsed() < within, "timed out waiting for: {what}");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        start.elapsed()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn two_sessions_stay_in_sync_through_everything() {
    let (Ok(url), Ok(token)) = (
        std::env::var("MISTY_VAULT_LIVE_URL"),
        std::env::var("MISTY_VAULT_LIVE_TOKEN"),
    ) else {
        eprintln!("skipped: the server's contract test runs this");
        return;
    };
    let wait = Duration::from_secs(10);

    let mut a = Session::new(&url, &token);
    assert!(a.api.server_vault().await.unwrap().is_none());
    a.edit("before-vault", Some("was already here"));
    a.create("Mac").await;
    a.start();
    a.until("the first upload", wait, |a| {
        let status = a.status();
        status.connected && status.sending == 0
    })
    .await;

    // A second session: a wrong password opens nothing and joins nothing.
    let mut b = Session::new(&url, &token);
    assert!(matches!(
        b.join("Wrong1!horse", "PC").await,
        Err(Error::Unlock)
    ));
    b.join(PASSWORD, "PC").await.unwrap();
    b.start();
    b.until("what was there before the vault", wait, |b| {
        b.title("before-vault").is_some()
    })
    .await;

    // A change reaches the other session in under three seconds, either way.
    a.edit("x", Some("from a"));
    let took = b
        .until("a change from a", wait, |b| b.title("x").is_some())
        .await;
    assert!(took < Duration::from_secs(3), "took {took:?}");
    println!("a change reached the other session in {took:?}");
    b.edit("y", Some("from b"));
    let took = a
        .until("a change from b", wait, |a| a.title("y").is_some())
        .await;
    assert!(took < Duration::from_secs(3), "took {took:?}");

    // A deletion goes both ways too.
    b.edit("x", None);
    a.until("a deletion", wait, |a| a.title("x").is_none()).await;

    // Paused: nothing moves. Both keep working, and it all merges on start, newest edit winning.
    a.edit("shared", Some("base"));
    b.until("the shared record", wait, |b| b.title("shared").is_some())
        .await;
    b.until("settled", wait, |b| b.status().sending == 0).await;
    b.pause().await;
    a.edit("while-paused-a", Some("a"));
    b.edit("while-paused-b", Some("b"));
    b.edit("shared", Some("older edit"));
    tokio::time::sleep(Duration::from_millis(20)).await;
    a.edit("shared", Some("newer edit"));
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(b.title("while-paused-a"), None);
    assert_eq!(a.title("while-paused-b"), None);
    b.start();
    b.until("what a did meanwhile", wait, |b| {
        b.title("while-paused-a").is_some()
    })
    .await;
    a.until("what b did meanwhile", wait, |a| {
        a.title("while-paused-b").is_some()
    })
    .await;
    for session in [&a, &b] {
        session
            .until("the newer edit", wait, |s| {
                s.title("shared").as_deref() == Some("newer edit")
            })
            .await;
    }

    // A big first sync: a new session gets everything, promptly.
    for index in 0..2_000 {
        a.edit(&format!("many-{index}"), Some("a bookmark"));
    }
    let start = Instant::now();
    a.until("the big upload", Duration::from_secs(60), |a| {
        a.store.lock().unwrap().waiting().unwrap().0 == 0
    })
    .await;
    println!("2,000 records uploaded in {:?}", start.elapsed());
    let mut c = Session::new(&url, &token);
    c.join(PASSWORD, "Laptop").await.unwrap();
    let start = Instant::now();
    c.start();
    c.until("the big download", Duration::from_secs(60), |c| {
        c.store.lock().unwrap().totals().unwrap().records > 2_000
    })
    .await;
    println!("2,000 records downloaded in {:?}", start.elapsed());

    // Settings can see who's signed in, and how much is stored under names it can't read.
    let sessions = a.api.sessions().await.unwrap();
    assert_eq!(sessions.len(), 3);
    assert!(sessions.iter().any(|session| session.name == "PC"));
    a.api.rename_session(&c.session_id, "Old laptop").await.unwrap();
    assert!(a
        .api
        .sessions()
        .await
        .unwrap()
        .iter()
        .any(|session| session.name == "Old laptop"));
    let usage = a.api.usage().await.unwrap();
    assert!(usage.bytes > 0);
    let names = keys::RecordKeys::new(a.root.as_ref().unwrap(), &a.vault_id).unwrap();
    assert_eq!(usage.scopes.len(), 1);
    assert_eq!(usage.scopes[0].scope, names.scope(P, C).unwrap());
    assert!(usage.scopes[0].records > 2_000);

    // Changing the password: nobody else is interrupted, and only the new one opens it.
    let vault = a.api.server_vault().await.unwrap().unwrap();
    let envelope = keys::seal_root(a.root.as_ref().unwrap(), &a.vault_id, "Another1!pass").unwrap();
    a.api
        .replace_sealed_root(a.root.as_ref().unwrap(), &vault, &envelope)
        .await
        .unwrap();
    a.edit("after-password", Some("still syncing"));
    b.until("a change after the password changed", wait, |b| {
        b.title("after-password").is_some()
    })
    .await;
    let mut d = Session::new(&url, &token);
    assert!(matches!(d.join(PASSWORD, "D").await, Err(Error::Unlock)));
    d.join("Another1!pass", "D").await.unwrap();
    let changed = a.api.server_vault().await.unwrap().unwrap();
    let transition = changed.key_transition.as_ref().unwrap();
    keys::verify_transition(
        &changed.root_public_key,
        &changed.vault_id,
        transition.generation,
        &changed.key_envelope,
        &transition.signature,
    )
    .unwrap();

    // A removed session stops at once and says so; it can't come back under that identity.
    a.api
        .remove_session(a.root.as_ref().unwrap(), &a.vault_id, &c.session_id)
        .await
        .unwrap();
    c.until("the removal", wait, |c| {
        c.status().notice == Some(Notice::SessionRemoved)
    })
    .await;
    assert!(c.status().stopped);
    a.edit("after-removal", Some("c never hears this"));
    b.until("a change after the removal", wait, |b| {
        b.title("after-removal").is_some()
    })
    .await;
    assert_eq!(c.title("after-removal"), None);

    // The server sees nothing readable.
    let everything = format!("{:?}", a.api.usage().await.unwrap());
    assert!(!everything.contains("bookmarks") && !everything.contains("personal"));

    // Destroying: every session stops and says why, and each keeps what it has.
    let kept = b.title("before-vault");
    assert!(a
        .api
        .destroy_vault_with_root(a.root.as_ref().unwrap(), &a.vault_id)
        .await
        .unwrap());
    b.until("the vault going", wait, |b| {
        b.status().notice == Some(Notice::VaultGone)
    })
    .await;
    assert_eq!(b.title("before-vault"), kept);
    assert!(a.api.server_vault().await.unwrap().is_none());

    // A new vault uploads from what's left, as if nothing had happened.
    a.pause().await;
    a.store.lock().unwrap().unlink().unwrap();
    a.create("Mac").await;
    a.start();
    a.until("the upload to a new vault", Duration::from_secs(60), |a| {
        a.status().connected && a.store.lock().unwrap().waiting().unwrap().0 == 0
    })
    .await;
    let usage = a.api.usage().await.unwrap();
    assert!(usage.scopes[0].records > 2_000);
    a.pause().await;
}
