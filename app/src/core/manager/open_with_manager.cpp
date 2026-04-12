#include "core/manager/open_with_manager.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"

namespace fs = std::filesystem;

namespace misty::core {

OpenWithManager& OpenWithManager::get() {
    static OpenWithManager instance;
    return instance;
}

std::optional<std::string> OpenWithManager::association_for_path(const std::string& file_path) {
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

void OpenWithManager::set_association_for_path(const std::string& file_path, const std::string& application_path) {
    std::lock_guard<std::mutex> lock(mu_);
    load_if_needed();
    associations_[association_key_for_path(file_path)] = application_path;
    save();
}

void OpenWithManager::load_if_needed() {
    if (loaded_) {
        return;
    }
    loaded_ = true;

    std::ifstream file(storage_path());
    if (!file.is_open()) {
        return;
    }

    try {
        nlohmann::json json;
        file >> json;
        if (!json.is_object()) {
            return;
        }
        for (auto it = json.begin(); it != json.end(); ++it) {
            if (it.value().is_string()) {
                associations_[it.key()] = it.value().get<std::string>();
            }
        }
    } catch (...) {
    }
}

void OpenWithManager::save() const {
    const fs::path path(storage_path());
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);

    nlohmann::json json = nlohmann::json::object();
    for (const auto& [key, value] : associations_) {
        json[key] = value;
    }

    std::ofstream file(path);
    if (!file.is_open()) {
        return;
    }
    file << json.dump(2);
}

std::string OpenWithManager::association_key_for_path(const std::string& file_path) const {
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

std::string OpenWithManager::storage_path() const {
    return (fs::path(EnvManager::get().get_user_home_dir()) / ".misty" / "open_with.json").string();
}

} // namespace misty::core
