#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace misty::core {

struct PluginVerificationResult {
    bool has_signature = false;
    bool signature_verified = false;
    bool hash_verified = false;
    std::string signer;
    std::vector<std::string> diagnostics;
};

std::string plugin_sdk_version();
std::string plugin_build_id();
std::string plugin_platform();
std::string plugin_arch();
bool plugin_requires_signature();
std::string sha256_for_file(const std::filesystem::path& path);

PluginVerificationResult verify_plugin_manifest(nlohmann::json& manifest,
                                                const std::filesystem::path& plugin_dir,
                                                const std::filesystem::path& library_path);

bool sign_plugin_manifest(const std::filesystem::path& plugin_dir,
                          const std::filesystem::path& private_key_path,
                          const std::string& signer,
                          const std::string& build_id_override,
                          const std::string& sdk_version_override,
                          std::string* error);

} // namespace misty::core
