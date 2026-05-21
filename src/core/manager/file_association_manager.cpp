#include "core/manager/file_association_manager.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/manager/settings_manager.h"

namespace fs = std::filesystem;

namespace misty::core {
namespace {

fs::path legacy_open_with_path() {
    return fs::path(EnvManager::get().get_user_home_dir()) / ".misty" / "open_with.json";
}

} // namespace

FileAssociationManager& FileAssociationManager::get() {
    static FileAssociationManager instance;
    return instance;
}

std::optional<std::string> FileAssociationManager::association_for_path(const std::string& file_path) {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed();

    const std::string key = association_key_for_path(file_path);
    auto it = associations_.find(key);
    if (it == associations_.end() || it->second.empty()) {
        return std::nullopt;
    }

    if (!fs::exists(it->second)) {
        associations_.erase(it);
        save();
        return std::nullopt;
    }

    return it->second;
}

void FileAssociationManager::set_association_for_path(const std::string& file_path, const std::string& application_path) {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed();
    associations_[association_key_for_path(file_path)] = application_path;
    save();
}

void FileAssociationManager::load_if_needed() {
    if (loaded_) {
        return;
    }
    loaded_ = true;

    auto load_associations = [&](const nlohmann::json& json) {
        if (!json.is_object()) {
            return false;
        }
        for (auto it = json.begin(); it != json.end(); ++it) {
            if (it.value().is_string()) {
                associations_[it.key()] = it.value().get<std::string>();
            }
        }
        return true;
    };

    nlohmann::json settings = load_settings_document();
    const bool has_open_with_settings =
        settings.contains("open_with") && settings["open_with"].is_object();
    if (has_open_with_settings && load_associations(settings["open_with"])) {
        return;
    }

    std::ifstream legacy_file(legacy_open_with_path());
    nlohmann::json legacy = nlohmann::json::object();
    if (legacy_file.is_open()) {
        try {
            legacy_file >> legacy;
        } catch (...) {
            legacy = nlohmann::json::object();
        }
    }
    if (load_associations(legacy)) {
        save();
        std::error_code ec;
        fs::remove(legacy_open_with_path(), ec);
    }
}

void FileAssociationManager::save() const {
    nlohmann::json open_with = nlohmann::json::object();
    for (const auto& [key, value] : associations_) {
        open_with[key] = value;
    }

    update_settings_document([&](nlohmann::json& settings) {
        settings["open_with"] = std::move(open_with);
    });
}

std::string FileAssociationManager::association_key_for_path(const std::string& file_path) const {
    fs::path path(file_path);
    std::string key = path.extension().string();
    if (key.empty()) {
        key = path.filename().string();
    }

    std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return key;
}

std::string FileAssociationManager::storage_path() const {
    return misty::core::settings_path().string();
}

} // namespace misty::core
