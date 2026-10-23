//! Live per-workspace fixture, driven by the server's
//! `TestBrowserSyncNativeWorkspacesAgainstGo`. Two real workers: A publishes its
//! workspace and sign-in data, B takes A's workspace over and receives A's tabs and
//! sign-ins, A is displaced and can no longer write them, then A takes its
//! workspace back and loads the sign-ins B wrote.
use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::Document,
    protocol::Vault,
    store::{CachedVault, DeviceSignin, Store},
    transport::SyncApi,
    workspace::signin,
    Error,
};
use serde_json::json;
use uuid::Uuid;

mod helpers;

use helpers::{
    changes, peer, publish_signins, read_signins, same, settled_signins, signins, wait_workspaces,
};

#[tokio::main]
async fn main() {
    let base = std::env::var("MISTY_SYNC_FIXTURE_BASE").expect("fixture server required");
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::COOKIE,
        std::env::var("MISTY_SYNC_FIXTURE_COOKIE")
            .unwrap()
            .parse()
            .unwrap(),
    );
    let _ = rustls::crypto::ring::default_provider().install_default();
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let api = SyncApi::new(&base, http).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "owner".into(),
        vault_id: Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let secret = generate_sync_secret();
    let password = "public test-only sync password";
    let wrapper = root.wrap(&scope, password, &secret).unwrap();
    let public = root.public_key().unwrap();
    let (a, b) = (DeviceKey::generate(), DeviceKey::generate());
    let (id_a, id_b) = (Uuid::new_v4().to_string(), Uuid::new_v4().to_string());
    let ga = root.grant(&scope, &id_a, 1, &a).unwrap();
    let gb = root.grant(&scope, &id_b, 1, &b).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let (path_a, path_b) = (
        directory.path().join("a.sqlite"),
        directory.path().join("b.sqlite"),
    );
    let initial = Document::default().encode().unwrap();
    let vault = |bootstrap: bool| CachedVault {
        vault: Vault {
            vault_id: scope.vault_id.clone(),
            key_epoch: 1,
            head_sequence: 0,
            root_public_key: public.clone(),
            key_envelope: Some(wrapper.clone()),
            space_key_envelope: None,
            key_transition: None,
        },
        bootstrap_pending: bootstrap,
        enrollment_pending: true,
    };
    drop(
        Store::initialize_vault(
            &path_a,
            scope.clone(),
            ga,
            &root,
            &a,
            &initial,
            Some(&vault(true)),
        )
        .unwrap(),
    );
    let root_b = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (ha, _ta) = peer(&path_a, api.clone(), scope.clone(), root);
    // Edits are accepted once A's copy of its workspace has arrived, which
    // can be after the roster names it the driver.
    wait_workspaces("A connects", &ha, |v| {
        v.driving_workspace.as_deref() == Some(id_a.as_str()) && v.writable
    })
    .await;

    ha.workspace_changes(changes(json!([
        {"action":"create","kind":"window","id":"w1","fields":{"title":"Main","order":0}},
        {"action":"create","kind":"layout","id":"l1","fields":{"window_id":"w1","title":"","order":0,"tree":{"type":"leaf","id":"p1"}}},
        {"action":"create","kind":"tab","id":"t1","fields":{"surface":"browser","title":"Docs","placement":{"layout_id":"l1","pane_id":"p1","order":0},"url":"https://example.com/","profile_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","website_id":null,"tool_route":null,"agent_owned":false}},
        {"action":"create","kind":"group","id":"g1","fields":{"label":"Work","icon":"briefcase","order":0,"hidden":false}}
    ])))
    .await
    .unwrap();
    wait_workspaces("A publishes", &ha, |v| {
        v.pending.is_empty()
            && v.contents
                .get(&id_a)
                .is_some_and(|w| w.version >= 1 && w.records.iter().any(|r| r.id == "t1"))
            // Folders and bookmarks live in the bookmarks collection.
            && v.collections
                .get("bookmarks")
                .is_some_and(|records| records.iter().any(|r| r.id == "g1"))
    })
    .await;

    // A's own sign-in data, under A's lock.
    ha.bind_signin(
        id_a.clone(),
        DeviceSignin {
            physical_id: "a".repeat(64),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let from_a = signins("token-from-a", "local-from-a");
    publish_signins(&ha, &id_a, &from_a).await.unwrap();
    let a_status = settled_signins("A publishes sign-ins", &ha, &id_a).await;
    assert!(
        a_status
            .binding
            .as_ref()
            .unwrap()
            .reflects(&a_status.server),
        "A's store reflects what it published"
    );

    drop(
        Store::initialize_vault(
            &path_b,
            scope.clone(),
            gb,
            &root_b,
            &b,
            &initial,
            Some(&vault(false)),
        )
        .unwrap(),
    );
    let (hb, _tb) = peer(&path_b, api.clone(), scope.clone(), root_b);
    wait_workspaces("B connects", &hb, |v| {
        v.driving_workspace.as_deref() == Some(id_b.as_str())
    })
    .await;

    // B continues on A's workspace: it opens it, takes the sign-in lease, and
    // gets A's tabs. A loses only the lease.
    hb.claim_workspace(id_a.clone())
        .await
        .expect("B claims A's tree");
    hb.open_workspace(id_a.clone())
        .await
        .expect("B opens A's tree");
    wait_workspaces("B drives A", &hb, |v| {
        v.driving_workspace.as_deref() == Some(id_a.as_str())
            && v.contents
                .get(&id_a)
                .is_some_and(|w| w.records.iter().any(|r| r.id == "t1"))
    })
    .await;
    wait_workspaces("A displaced", &ha, |v| v.driving_workspace.is_none()).await;
    // Workspaces have many writers: A still edits the workspace it is on.
    ha.workspace_changes(changes(
        json!([{"action":"patch","kind":"tab","id":"t1","fields":{"title":"Edited on A"}}]),
    ))
    .await
    .expect("a machine without the lease still edits");

    // B receives exactly A's sign-ins; displaced A can no longer write them.
    let b_view = settled_signins("B sees A's sign-ins", &hb, &id_a).await;
    assert_eq!(b_view.server, a_status.server);
    assert!(
        b_view.binding.is_none(),
        "B has no store for A's device yet, so it must load it"
    );
    assert!(same(
        &read_signins(&hb, &id_a, &b_view).await,
        &signin::unpack(
            signin::pack(&from_a, &Default::default())
                .unwrap()
                .shards
                .values()
                .map(Vec::as_slice)
        )
        .unwrap()
    ));
    assert!(
        matches!(
            publish_signins(&ha, &id_a, &signins("stale-a", "stale-a")).await,
            Err(Error::InactiveDevice)
        ),
        "a displaced device cannot write sign-ins"
    );
    hb.bind_signin(
        id_a.clone(),
        DeviceSignin {
            physical_id: "b".repeat(64),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let from_b = signins("token-from-b", "local-from-b");
    publish_signins(&hb, &id_a, &from_b).await.unwrap();
    let b_status = settled_signins("B publishes A's sign-ins", &hb, &id_a).await;
    assert_ne!(b_status.server, a_status.server);

    // B edits A's workspace; A takes it back and sees the edit.
    hb.workspace_changes(changes(
        json!([{"action":"patch","kind":"window","id":"w1","fields":{"title":"Edited on B"}}]),
    ))
    .await
    .unwrap();
    // Wait for the edit itself: sign-in writes also advance the version.
    wait_workspaces("B publishes", &hb, |v| {
        v.pending.is_empty()
            && v.contents.get(&id_a).is_some_and(|w| {
                w.records
                    .iter()
                    .any(|r| r.fields.get("title") == Some(&json!("Edited on B")))
            })
    })
    .await;
    ha.claim_workspace(id_a.clone())
        .await
        .expect("A takes its tree back");
    wait_workspaces("A drives again", &ha, |v| {
        let title = |t: &str| {
            v.contents.get(&id_a).is_some_and(|w| {
                w.records
                    .iter()
                    .any(|r| r.fields.get("title") == Some(&json!(t)))
            })
        };
        // Both machines' edits survive, each batched and rebased.
        v.driving_workspace.as_deref() == Some(id_a.as_str())
            && title("Edited on B")
            && title("Edited on A")
    })
    .await;
    wait_workspaces("B displaced", &hb, |v| v.driving_workspace.is_none()).await;

    // A's store no longer reflects its device: it must load what B wrote.
    let back = settled_signins("A sees B's sign-ins", &ha, &id_a).await;
    assert_eq!(back.server, b_status.server);
    assert!(
        !back.binding.as_ref().unwrap().reflects(&back.server),
        "A detects that another session wrote its device"
    );
    let loaded = read_signins(&ha, &id_a, &back).await;
    assert!(
        loaded[0].payload.to_string().contains("token-from-b")
            && loaded[1].payload["k"] == "local-from-b"
    );
    println!("native_workspace_fixture_ok");
}
