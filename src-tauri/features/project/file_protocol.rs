use std::borrow::Cow;

use tauri::{
    http::{header, Request, Response, StatusCode},
    UriSchemeContext, UriSchemeResponder, Wry,
};

use super::files::{image_mime, is_image};
use super::linked_path;
use crate::app::trusted_windows::asset_protocol::{app_origin, requested_path};

pub const SCHEME: &str = "misty-file";

const IMAGE_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

pub fn handle(
    context: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let origin = app_origin(&app);
    if !crate::browser::app_windows::is_person_window(context.webview_label()) {
        responder.respond(status(StatusCode::FORBIDDEN, &origin));
        return;
    }
    tauri::async_runtime::spawn(async move {
        let response = serve(&app, &request, &origin)
            .await
            .unwrap_or_else(|code| status(code, &origin));
        responder.respond(response);
    });
}

fn status(code: StatusCode, origin: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}

pub(crate) fn requested(uri: &tauri::http::Uri) -> Option<(String, String)> {
    let path = requested_path(uri.path()).filter(|path| path.as_ref().is_absolute())?;
    let account = url::form_urlencoded::parse(uri.query()?.as_bytes())
        .find(|(key, _)| key == "account")
        .map(|(_, value)| value.into_owned())
        .filter(|account| !account.is_empty())?;
    Some((account, path.as_ref().to_str()?.to_owned()))
}

async fn serve(
    app: &tauri::AppHandle,
    request: &Request<Vec<u8>>,
    origin: &str,
) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    let (account, path) = requested(request.uri()).ok_or(StatusCode::FORBIDDEN)?;
    let file = linked_path(app, &account, &path)
        .await
        .map_err(|_| StatusCode::FORBIDDEN)?;
    if !is_image(&file) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mime = image_mime(&file);
    let body = tokio::task::spawn_blocking(move || {
        if !file_access::fs::is_file(&file) {
            return Err(StatusCode::NOT_FOUND);
        }
        file_access::fs::read(&file).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::FORBIDDEN,
        })
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;
    Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, IMAGE_CSP)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(body))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(text: &str) -> tauri::http::Uri {
        text.parse().unwrap()
    }

    #[test]
    fn a_request_names_an_account_and_an_absolute_path_without_parent_steps() {
        assert_eq!(
            requested(&uri(
                "misty-file://localhost/%2FUsers%2Fme%2Fsite%2Fa%20b.png?account=acc-1&v=12"
            )),
            Some(("acc-1".to_owned(), "/Users/me/site/a b.png".to_owned()))
        );
        assert_eq!(
            requested(&uri(
                "http://misty-file.localhost/%2FUsers%2Fme%2Fa.png?v=1&account=acc%201"
            ))
            .map(|(account, _)| account),
            Some("acc 1".to_owned())
        );
        assert!(requested(&uri("misty-file://localhost/%2FUsers%2Fme%2Fa.png")).is_none());
        assert!(requested(&uri(
            "misty-file://localhost/%2FUsers%2Fme%2Fa.png?account="
        ))
        .is_none());
        assert!(requested(&uri(
            "misty-file://localhost/%2FUsers%2Fme%2F..%2F..%2Fetc%2Fpasswd?account=a"
        ))
        .is_none());
        assert!(requested(&uri("misty-file://localhost/relative.png?account=a")).is_none());
    }
}
