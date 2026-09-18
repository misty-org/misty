use misty_peer_transport::{Command, Transport};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::mpsc,
    task::JoinSet,
};
const MAX_FRAME: u64 = 128 * 1024;
const MAX_PENDING: usize = 64;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    protocol: u32,
    id: u64,
    command: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cancel {
    operation: String,
    request_id: u64,
}
#[tokio::main]
async fn main() {
    let failed = run().await.is_err();
    if failed {
        eprintln!("Peer transport stopped after an invalid or closed supervisor channel.");
    }
    // Tokio's standard streams use blocking OS IO. After endpoint shutdown,
    // exit also releases any blocked stdin/stdout helper threads.
    std::process::exit(if failed { 1 } else { 0 });
}
async fn run() -> Result<(), String> {
    let transport = Arc::new(Transport::default());
    let (input, mut receive) = mpsc::channel(8);
    let reader = tokio::spawn(async move {
        let mut stdin = BufReader::new(tokio::io::stdin());
        loop {
            let mut bytes = Vec::new();
            if (&mut stdin)
                .take(MAX_FRAME + 1)
                .read_until(b'\n', &mut bytes)
                .await
                .is_err()
                || bytes.is_empty()
            {
                break;
            }
            if bytes.len() as u64 > MAX_FRAME {
                let _ = input.send(Err("Peer frame exceeds its limit.")).await;
                break;
            }
            let request =
                serde_json::from_slice::<Request>(&bytes).map_err(|_| "Invalid peer request.");
            let failed = request.is_err();
            if input.send(request).await.is_err() || failed {
                break;
            }
        }
    });
    let (output, mut outgoing) = mpsc::channel::<Value>(128);
    let mut writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(value) = outgoing.recv().await {
            let mut bytes = serde_json::to_vec(&value).map_err(|_| ())?;
            bytes.push(b'\n');
            stdout.write_all(&bytes).await.map_err(|_| ())?;
            stdout.flush().await.map_err(|_| ())?;
        }
        Ok::<(), ()>(())
    });
    let mut jobs = JoinSet::<(u64, Result<Value, String>)>::new();
    let mut pending = HashMap::<u64, tokio::task::AbortHandle>::new();
    let mut last_id: Option<u64> = None;
    let result=async {
        loop {
            tokio::select! {
                _=&mut writer=>return Err("Peer output closed.".to_string()),
                completed=jobs.join_next(), if !jobs.is_empty()=> {
                    if let Some(Ok((id,result)))=completed {
                        // A canceled task may already have completed in JoinSet.
                        // Its cancellation acknowledgement is the final response.
                        if pending.remove(&id).is_none() {
                            if let Ok(value) = result {
                                if let Some(stream) = value.get("stream").and_then(Value::as_str) {
                                    let _ = transport.execute(Command::ReleaseStream {stream:stream.to_owned()}).await;
                                } else if let Some(connection) = value.get("connection").and_then(Value::as_str) {
                                    let _ = transport.execute(Command::CloseConnection {connection:connection.to_owned()}).await;
                                }
                            }
                            continue;
                        }
                        let response=match result {Ok(value)=>json!({"protocol":1,"id":id,"result":value}),Err(error)=>json!({"protocol":1,"id":id,"error":error})};
                        output.try_send(response).map_err(|_|"Peer output is stalled.".to_string())?;
                    }
                },
                request=receive.recv()=> {
                    let Some(request)=request else {return Ok(());};
                    let request=request.map_err(str::to_owned)?;
                    if request.protocol!=1 || last_id.is_some_and(|id|request.id<=id) {return Err("Invalid peer protocol or duplicate request.".into());}
                    last_id=Some(request.id);
                    if request.command.get("operation").and_then(Value::as_str)==Some("cancel") {
                        let cancel:Cancel=serde_json::from_value(request.command).map_err(|_|"Invalid cancellation request.".to_string())?;
                        if cancel.operation!="cancel" {return Err("Invalid cancellation request.".into());}
                        if let Some(job)=pending.remove(&cancel.request_id) {job.abort();}
                        output.try_send(json!({"protocol":1,"id":request.id,"result":null})).map_err(|_|"Peer output is stalled.".to_string())?;
                        continue;
                    }
                    if pending.len()>=MAX_PENDING {
                        output.try_send(json!({"protocol":1,"id":request.id,"error":"Peer transport is busy."})).map_err(|_|"Peer output is stalled.".to_string())?;
                        continue;
                    }
                    let command:Command=serde_json::from_value(request.command).map_err(|_|"Invalid peer operation.".to_string())?;
                    let transport=transport.clone();
                    let handle=jobs.spawn(async move {(request.id,transport.execute(command).await)});
                    pending.insert(request.id,handle);
                }
            }
        }
    }.await;
    reader.abort();
    jobs.abort_all();
    while jobs.join_next().await.is_some() {}
    transport.shutdown().await;
    writer.abort();
    result
}
