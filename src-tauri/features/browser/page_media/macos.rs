use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_foundation::{NSObjectProtocol, NSString};
use objc2_web_kit::{
    WKContentWorld, WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKUserScript,
    WKUserScriptInjectionTime, WKWebView,
};

const HANDLER: &str = "mistyMedia";
const AUDIO_MUTED: usize = 1;
const NOT_MUTED: usize = 0;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct MistyPageMedia;

    unsafe impl NSObjectProtocol for MistyPageMedia {}

    unsafe impl WKScriptMessageHandler for MistyPageMedia {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            unsafe {
                if !message.frameInfo().isMainFrame() {
                    return;
                }
                let Ok(body) = message.body().downcast::<NSString>() else {
                    return;
                };
                let Some(view) = message.webView() else {
                    return;
                };
                let Some(label) = super::label_of_view(Retained::as_ptr(&view) as usize) else {
                    return;
                };
                super::receive(&label, &body.to_string());
            }
        }
    }
);

impl MistyPageMedia {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

pub(super) fn install(view: &WKWebView, source: &str) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("Page media is watched from the main thread.")?;
    unsafe {
        let controller = view.configuration().userContentController();
        if controller
            .userScripts()
            .iter()
            .any(|script| script.source().to_string() == source)
        {
            return Ok(());
        }
        let world = WKContentWorld::pageWorld(mtm);
        let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
            WKUserScript::alloc(mtm),
            &NSString::from_str(source),
            WKUserScriptInjectionTime::AtDocumentStart,
            true,
            &world,
        );
        controller.addUserScript(&script);
        let handler = MistyPageMedia::new(mtm);
        controller.addScriptMessageHandler_contentWorld_name(
            ProtocolObject::from_ref(&*handler),
            &world,
            &NSString::from_str(HANDLER),
        );
    }
    Ok(())
}

pub(super) unsafe fn set_muted(view: &WKWebView, muted: bool) {
    let view: &AnyObject = &*(view as *const WKWebView).cast();
    let responds: bool = msg_send![view, respondsToSelector: objc2::sel!(_setPageMuted:)];
    if responds {
        let state = if muted { AUDIO_MUTED } else { NOT_MUTED };
        let _: () = msg_send![view, _setPageMuted: state];
    }
}
