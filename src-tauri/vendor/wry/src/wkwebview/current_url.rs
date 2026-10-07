// SPDX-License-Identifier: MIT
use super::WKWebView;
use crate::{Error, Result};
use std::ffi::c_char;

pub(crate) fn url_from_webview(webview: &WKWebView) -> Result<String> {
  // WKWebView legitimately has no URL before its first navigation. Propagate
  // that state instead of panicking or inventing an origin for IPC checks.
  let url_obj = unsafe { webview.URL() }.ok_or(Error::UrlNotAvailable)?;
  let absolute_url = url_obj.absoluteString().ok_or(Error::UrlNotAvailable)?;

  let bytes = {
    let bytes: *const c_char = absolute_url.UTF8String();
    bytes as *const u8
  };

  // 4 represents utf8 encoding
  let len = absolute_url.lengthOfBytesUsingEncoding(4);
  let bytes = unsafe { std::slice::from_raw_parts(bytes, len) };

  std::str::from_utf8(bytes)
    .map(Into::into)
    .map_err(Into::into)
}
