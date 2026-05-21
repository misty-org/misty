#pragma once

#include <filesystem>
#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace misty::core {

std::filesystem::path settings_path();
nlohmann::json load_settings_document();
bool save_settings_document(const nlohmann::json& document, std::string* error = nullptr);
bool update_settings_document(
    const std::function<void(nlohmann::json&)>& updater,
    std::string* error = nullptr);

} // namespace misty::core
