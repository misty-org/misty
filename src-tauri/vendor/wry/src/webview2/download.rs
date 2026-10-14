// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Downloads in progress, so an app can show their progress and cancel them,
//! as `wkwebview::download` does on macOS.

use std::{cell::RefCell, collections::HashMap};

use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};

thread_local! {
  /// Keyed by destination path. WebView2 objects belong to the UI thread,
  /// so the registry lives there.
  static ACTIVE_DOWNLOADS: RefCell<HashMap<String, ICoreWebView2DownloadOperation>> =
    RefCell::new(HashMap::new());
}

/// Tracks `operation`, saving to `destination`, until it stops.
pub(crate) fn track(operation: &ICoreWebView2DownloadOperation, destination: String) {
  let key = destination.clone();
  let finished = StateChangedEventHandler::create(Box::new(move |operation, _| {
    let Some(operation) = operation else {
      return Ok(());
    };
    let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
    unsafe { operation.State(&mut state)? };
    if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
      ACTIVE_DOWNLOADS.with(|active| active.borrow_mut().remove(&key));
    }
    Ok(())
  }));
  let mut token = 0i64;
  if unsafe { operation.add_StateChanged(&finished, &mut token) }.is_ok() {
    ACTIVE_DOWNLOADS.with(|active| {
      active.borrow_mut().insert(destination, operation.clone());
    });
  }
}

/// Bytes received and expected (-1 when unknown) for a download in progress.
/// Must be called on the UI thread.
pub fn download_progress(destination: &str) -> Option<(i64, i64)> {
  ACTIVE_DOWNLOADS.with(|active| {
    let active = active.borrow();
    let operation = active.get(destination)?;
    let (mut received, mut total) = (0i64, 0i64);
    unsafe {
      operation.BytesReceived(&mut received).ok()?;
      operation.TotalBytesToReceive(&mut total).ok()?;
    }
    Some((received, if total > 0 { total } else { -1 }))
  })
}

/// Cancels a download in progress; WebView2 removes its partial file.
/// Must be called on the UI thread.
pub fn cancel_download(destination: &str) -> bool {
  let operation = ACTIVE_DOWNLOADS.with(|active| active.borrow_mut().remove(destination));
  operation.is_some_and(|operation| unsafe { operation.Cancel() }.is_ok())
}
