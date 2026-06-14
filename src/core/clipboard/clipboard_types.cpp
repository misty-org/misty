#include "core/clipboard/clipboard_types.h"

namespace misty::core {

bool ClipboardPayload::empty() const {
    if (kind == ClipboardPayloadKind::Text) {
        return text.empty();
    }
    if (kind == ClipboardPayloadKind::Html) {
        return html.empty() && text.empty();
    }
    if (kind == ClipboardPayloadKind::Image) {
        return images.empty();
    }
    if (kind == ClipboardPayloadKind::FileRefs) {
        return file_refs.empty();
    }
    return text.empty() && html.empty() && file_refs.empty() && images.empty();
}

}  // namespace misty::core
