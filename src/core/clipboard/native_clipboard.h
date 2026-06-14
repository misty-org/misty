#pragma once

#include <functional>
#include <optional>
#include <string>
#include <utility>

#include "core/clipboard/clipboard_types.h"

namespace misty::core {

class NativeClipboard {
public:
    using ChangeCallback = std::function<void()>;

    virtual ~NativeClipboard() = default;
    virtual bool start(ChangeCallback on_change) = 0;
    virtual void stop() = 0;
    virtual std::optional<ClipboardPayload> read_payload() const {
        auto text = read_text();
        if (!text.has_value()) {
            return std::nullopt;
        }
        ClipboardPayload payload;
        payload.kind = text->empty() ? ClipboardPayloadKind::Empty : ClipboardPayloadKind::Text;
        payload.origin = ClipboardOrigin::LocalSystem;
        payload.text = std::move(*text);
        return payload;
    }
    virtual bool write_payload(const ClipboardPayload& payload) {
        if (payload.kind == ClipboardPayloadKind::Text ||
            (!payload.text.empty() && payload.images.empty() && payload.file_refs.empty() && payload.html.empty())) {
            return write_text(payload.text);
        }
        return false;
    }
    virtual std::optional<std::string> read_text() const = 0;
    virtual bool write_text(const std::string& text) = 0;
    virtual bool supported() const = 0;
};

}  // namespace misty::core
