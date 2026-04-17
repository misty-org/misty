#include "panels/settings/settings_state.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

namespace misty::panel {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

std::filesystem::path llm_config_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        return {};
    }
    return fs::path(home) / "misty" / "config" / "llm.json";
}

} // namespace

void SettingsState::ensure_llm_config_loaded() {
    if (llm_config_loaded) {
        return;
    }

    const fs::path path = llm_config_path();
    if (!path.empty() && fs::exists(path)) {
        try {
            std::ifstream file(path);
            json data = json::parse(file);

            const std::string api_url = data.value("api_url", std::string(llm_api_url));
            const std::string model = data.value("model", std::string(llm_model));
            const std::string api_key = data.value("api_key", std::string(llm_api_key));

            std::snprintf(llm_api_url, sizeof(llm_api_url), "%s", api_url.c_str());
            std::snprintf(llm_model, sizeof(llm_model), "%s", model.c_str());
            std::snprintf(llm_api_key, sizeof(llm_api_key), "%s", api_key.c_str());
        } catch (...) {
        }
    }

    llm_config_loaded = true;
}

bool SettingsState::save_llm_config(std::string* error) {
    const fs::path path = llm_config_path();
    if (path.empty()) {
        if (error) *error = "Unable to resolve ~/misty/config/llm.json.";
        return false;
    }

    try {
        fs::create_directories(path.parent_path());
        json data = {
            {"api_url", std::string(llm_api_url)},
            {"model", std::string(llm_model)},
            {"api_key", std::string(llm_api_key)},
        };

        std::ofstream file(path);
        if (!file.is_open()) {
            if (error) *error = "Failed to open ~/misty/config/llm.json for writing.";
            return false;
        }
        file << data.dump(2);
        llm_config_loaded = true;
        return true;
    } catch (const std::exception& ex) {
        if (error) *error = ex.what();
        return false;
    }
}

bool SettingsState::llm_is_configured() const {
    return llm_api_url[0] != '\0' && llm_model[0] != '\0' && llm_api_key[0] != '\0';
}

} // namespace misty::panel
