//! Fail-closed WebView2 policy for untrusted App content.
//!
//! Browser permission prompts are not a capability boundary: the App must use
//! Misty's broker even when Windows or Edge would otherwise allow the request.
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, COREWEBVIEW2_PERMISSION_STATE_DENY,
    },
    PermissionRequestedEventHandler,
};

pub unsafe fn install(controller: ICoreWebView2Controller) -> Result<(), String> {
    let webview = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let settings = unsafe { webview.Settings() }.map_err(|error| error.to_string())?;

    // Apps communicate only through mini_app_rpc. COM host objects, Edge UI,
    // script dialogs and developer tools would create additional ambient paths.
    unsafe { settings.SetAreHostObjectsAllowed(false) }.map_err(|error| error.to_string())?;
    unsafe { settings.SetAreDefaultContextMenusEnabled(false) }
        .map_err(|error| error.to_string())?;
    unsafe { settings.SetAreDefaultScriptDialogsEnabled(false) }
        .map_err(|error| error.to_string())?;
    unsafe { settings.SetAreDevToolsEnabled(false) }.map_err(|error| error.to_string())?;
    unsafe { settings.SetIsStatusBarEnabled(false) }.map_err(|error| error.to_string())?;

    let mut host_objects_allowed = Default::default();
    unsafe { settings.AreHostObjectsAllowed(&mut host_objects_allowed) }
        .map_err(|error| error.to_string())?;
    if host_objects_allowed.as_bool() {
        return Err("App WebView2 host-object isolation could not be enabled.".into());
    }

    // Deny every current and future WebView2 permission kind. A separately
    // granted Misty capability performs the operation in trusted Host code.
    let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
        if let Some(args) = args {
            unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)? };
        }
        Ok(())
    }));
    let mut token = 0i64;
    unsafe { webview.add_PermissionRequested(&handler, &mut token) }
        .map_err(|error| error.to_string())?;

    Ok(())
}
