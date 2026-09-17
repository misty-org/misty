//! WebView2 owns capture, including cross-origin frames and native page rendering.
use base64::Engine;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::Webview;
use webview2_com::{
    CapturePreviewCompletedHandler,
    Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
};
use windows::Win32::{
    Foundation::HGLOBAL,
    System::Com::{
        StructuredStorage::CreateStreamOnHGlobal, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
    },
};

pub async fn capture(webview: Webview) -> Result<Value, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    webview.with_webview(move|platform|unsafe{
  let start=(||->Result<(),String>{
   let stream=CreateStreamOnHGlobal(HGLOBAL::default(),true).map_err(|e|e.to_string())?;
   let result_stream=stream.clone();let reply=sender.clone();
   let handler=CapturePreviewCompletedHandler::create(Box::new(move|status|{
    let result=(||->Result<Value,String>{
     status.map_err(|e|e.to_string())?;
     let mut info=STATSTG::default();
     result_stream.Stat(&mut info,STATFLAG_NONAME).map_err(|e|e.to_string())?;
     if info.cbSize==0||info.cbSize>10*1024*1024{return Err("Capture image exceeds 10 MB".into())}
     result_stream.Seek(0,STREAM_SEEK_SET,None).map_err(|e|e.to_string())?;
     let mut data=vec![0u8;info.cbSize as usize];let mut read=0u32;
     result_stream.Read(data.as_mut_ptr().cast(),data.len() as u32,Some(&mut read)).ok().map_err(|e|e.to_string())?;
     if read as usize!=data.len(){return Err("Capture image was incomplete".into())}
     Ok(json!({"dataUrl":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(data))}))
    })();
    if let Some(sender)=reply.lock().ok().and_then(|mut value|value.take()){let _=sender.send(result);}
    Ok(())
   }));
   platform.controller().CoreWebView2().map_err(|e|e.to_string())?.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,&stream,&handler).map_err(|e|e.to_string())?;
   Ok(())
  })();
  if let Err(error)=start{if let Some(sender)=sender.lock().ok().and_then(|mut value|value.take()){let _=sender.send(Err(error));}}
 }).map_err(|e|e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "Capture timed out")?
        .map_err(|_| "Capture canceled")?
}
