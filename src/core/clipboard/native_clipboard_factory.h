#pragma once

#include <memory>

#include "core/clipboard/native_clipboard.h"

namespace misty::core {

std::unique_ptr<NativeClipboard> create_native_clipboard();

}  // namespace misty::core
