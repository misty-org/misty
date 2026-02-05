#ifdef _WIN32

#include "application_picker.h"

#include <windows.h>
#include <commdlg.h>

#include <array>

namespace misty::core {

std::optional<std::string> ApplicationPicker::pick() {
    std::array<char, MAX_PATH> buffer{};

    OPENFILENAMEA ofn{};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = nullptr;
    ofn.lpstrFile = buffer.data();
    ofn.nMaxFile = static_cast<DWORD>(buffer.size());
    ofn.lpstrFilter = "Applications (*.exe)\0*.exe\0All Files (*.*)\0*.*\0";
    ofn.nFilterIndex = 1;
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
    ofn.lpstrTitle = "Choose Application";

    if (!GetOpenFileNameA(&ofn)) {
        return std::nullopt;
    }

    return std::string(buffer.data());
}

} // namespace misty::core

#endif
