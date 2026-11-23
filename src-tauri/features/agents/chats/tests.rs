use super::*;

#[tokio::test]
async fn adopting_moves_chats_and_leaves_approvals_behind() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::at(directory.path().join("misty.db"));
    let service = AgentChatsService::new(store.clone());
    let put = |account: &str, kind: &str, id: &str, document: &str| {
        service.put(account.into(), kind.into(), id.into(), document.into())
    };
    assert_eq!(
        service.adoptable("local".into(), "a".into()).await.unwrap(),
        0
    );
    put("local", "conversation", "c1", "{}").await.unwrap();
    put("local", "agent", "sitegrant_x", "{}").await.unwrap();
    put("local", "agent", "personal_misty", "{}").await.unwrap();
    assert_eq!(
        service.adoptable("local".into(), "a".into()).await.unwrap(),
        1
    );
    service.adopt("local".into(), "a".into()).await.unwrap();
    assert_eq!(
        service.adoptable("local".into(), "a".into()).await.unwrap(),
        0
    );
    let kept = |account: &str| -> Vec<String> {
        let connection = store.connect().unwrap();
        let mut statement = connection
            .prepare("SELECT id FROM agent_chats WHERE account = ?1 AND kind = 'agent' ORDER BY id")
            .unwrap();
        let ids = statement
            .query_map([account], |row| row.get::<_, String>(0))
            .unwrap()
            .flatten()
            .collect();
        ids
    };
    assert_eq!(kept("a"), ["personal_misty"]);
    assert_eq!(kept("local"), ["sitegrant_x"]);
}

#[tokio::test]
async fn chats_stay_per_account_and_kind() {
    let directory = tempfile::tempdir().unwrap();
    let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
    let put = |account: &str, kind: &str, id: &str, document: &str| {
        service.put(account.into(), kind.into(), id.into(), document.into())
    };
    put("a", "conversation", "c1", r#"{"id":"c1"}"#)
        .await
        .unwrap();
    put("a", "conversation", "c1", r#"{"id":"c1","title":"Edited"}"#)
        .await
        .unwrap();
    put("a", "folder", "f1", r#"{"id":"f1"}"#).await.unwrap();
    put("b", "conversation", "c2", r#"{"id":"c2"}"#)
        .await
        .unwrap();
    let listed = service
        .list("a".into(), "conversation".into())
        .await
        .unwrap();
    assert_eq!(
        listed,
        vec![
            r#"{"hasOlderMessages":false,"id":"c1","messageBeforeSeq":null,"messages":[],"title":"Edited"}"#
                .to_owned()
        ]
    );
    service
        .delete("a".into(), "conversation".into(), "c1".into())
        .await
        .unwrap();
    assert!(service
        .list("a".into(), "conversation".into())
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        service
            .list("b".into(), "conversation".into())
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn signing_in_brings_signed_out_chats_along_and_keeps_the_accounts_own() {
    let directory = tempfile::tempdir().unwrap();
    let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
    let put = |account: &str, id: &str, text: &str| {
        service.put(
            account.into(),
            "conversation".into(),
            id.into(),
            format!("{{\"t\":\"{text}\"}}"),
        )
    };
    put("local", "a", "signed out").await.unwrap();
    put("local", "b", "signed out").await.unwrap();
    put("me", "b", "the account's").await.unwrap();
    assert_eq!(service.adopt("local".into(), "me".into()).await.unwrap(), 1);
    let mine = service
        .list("me".into(), "conversation".into())
        .await
        .unwrap();
    assert_eq!(mine.len(), 2);
    assert!(mine.iter().any(|row| row.contains("the account's")));
}

#[tokio::test]
async fn a_swap_writes_only_over_what_it_read() {
    let directory = tempfile::tempdir().unwrap();
    let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
    let swap = |expected: Option<&str>, document: &str| {
        service.swap(
            "a".into(),
            "collaboration".into(),
            "c1".into(),
            expected.map(str::to_owned),
            document.into(),
        )
    };
    let read = || service.get("a".into(), "collaboration".into(), "c1".into());
    assert_eq!(read().await.unwrap(), None);
    assert!(swap(None, r#"{"v":1}"#).await.unwrap());
    assert!(!swap(None, r#"{"v":2}"#).await.unwrap());
    assert!(!swap(Some(r#"{"v":0}"#), r#"{"v":2}"#).await.unwrap());
    assert_eq!(read().await.unwrap().as_deref(), Some(r#"{"v":1}"#));
    assert!(swap(Some(r#"{"v":1}"#), r#"{"v":2}"#).await.unwrap());
    assert_eq!(read().await.unwrap().as_deref(), Some(r#"{"v":2}"#));
    assert!(swap(Some(r#"{"v":2}"#), "not json").await.is_err());
}

#[tokio::test]
async fn racing_swaps_have_one_winner() {
    let directory = tempfile::tempdir().unwrap();
    let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
    let start = r#"{"state":"idle"}"#;
    service
        .put("a".into(), "run".into(), "s1".into(), start.into())
        .await
        .unwrap();
    let racers: Vec<_> = (0..8)
        .map(|index| {
            let service = service.clone();
            tokio::spawn(async move {
                service
                    .swap(
                        "a".into(),
                        "run".into(),
                        "s1".into(),
                        Some(start.to_owned()),
                        format!(r#"{{"state":"running","by":{index}}}"#),
                    )
                    .await
                    .unwrap()
            })
        })
        .collect();
    let mut winners = 0;
    for racer in racers {
        winners += usize::from(racer.await.unwrap());
    }
    assert_eq!(winners, 1);
}

#[tokio::test]
async fn bad_documents_and_kinds_are_refused() {
    let directory = tempfile::tempdir().unwrap();
    let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
    assert!(service
        .put(
            "a".into(),
            "conversation".into(),
            "c1".into(),
            "not json".into()
        )
        .await
        .is_err());
    assert!(service
        .put("a".into(), "secrets".into(), "c1".into(), "{}".into())
        .await
        .is_err());
}

#[tokio::test]
async fn an_agents_voice_is_a_short_catalog_id() {
    let directory = tempfile::tempdir().unwrap();
    let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
    let put = |voice: &str| {
        service.put(
            "a".into(),
            "agent".into(),
            "agent1".into(),
            format!(r#"{{"name":"Ada","voice":{voice}}}"#),
        )
    };
    assert!(put(r#""kokoro-heart""#).await.is_ok());
    assert!(put(r#""""#).await.is_ok());
    assert!(put("null").await.is_ok());
    assert!(put(r#""Kokoro Heart""#).await.is_err());
    assert!(put(&format!(r#""{}""#, "a".repeat(65))).await.is_err());
    assert!(put("3").await.is_err());
    assert!(service
        .put(
            "a".into(),
            "agent".into(),
            "agent2".into(),
            r#"{"name":"Old"}"#.into()
        )
        .await
        .is_ok());
}
