use super::*;
#[tokio::test]
async fn counts_actual_websocket_payloads_and_shares_them_across_reconnect_clients() {
    // Like the worker tests, install the provider here: it must not depend
    // on another test having run first.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
        let received = socket.next().await.unwrap().unwrap().into_text().unwrap();
        socket
            .send(Message::Ping(vec![1, 2, 3].into()))
            .await
            .unwrap();
        let body = r#"{"type":"presence","devices":[]}"#;
        socket.send(Message::Text(body.into())).await.unwrap();
        (received.len() as u64, body.len() as u64)
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    let api = SyncApi::new("http://127.0.0.1", reqwest::Client::new()).unwrap();
    let next_connection = api.clone();
    send(&mut socket, &api.traffic, &ClientFrame::Resume { after: 7 })
        .await
        .unwrap();
    let mut last = Instant::now();
    assert!(matches!(
        receive(&mut socket, &mut last, &api.traffic).await.unwrap(),
        ServerFrame::Presence { .. }
    ));
    let (up, down) = server.await.unwrap();
    assert_eq!(next_connection.traffic().snapshot().uploaded_bytes, up);
    assert_eq!(next_connection.traffic().snapshot().downloaded_bytes, down);
    assert_eq!(
        SyncApi::new("http://127.0.0.1", reqwest::Client::new())
            .unwrap()
            .traffic()
            .snapshot()
            .uploaded_bytes,
        0
    );
}
