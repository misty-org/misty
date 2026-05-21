#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace misty::core {

struct HostPlatform {
    std::string os;
    std::string arch;
    std::string runtime;
};

struct ManifestVariant {
    std::string os;
    std::string arch;
    std::string runtime;
    std::string library;
    std::string sha256;
    std::string build_id;
    std::string plugin_api_version;
};

struct PluginVerificationResult {
    bool has_signature = false;
    bool signature_verified = false;
    bool hash_verified = false;
    std::string signer;
    std::vector<std::string> diagnostics;
};

HostPlatform current_host_platform();

std::optional<ManifestVariant> select_variant(
    const std::vector<ManifestVariant>& variants,
    const HostPlatform& host);

std::string plugin_sdk_version();
std::string plugin_build_id();
bool plugin_requires_signature();
std::string sha256_for_file(const std::filesystem::path& path);

PluginVerificationResult verify_plugin_manifest(
    nlohmann::json& manifest,
    const std::filesystem::path& plugin_dir,
    const std::filesystem::path& library_path,
    const ManifestVariant& selected);

bool sign_plugin_manifest(const std::filesystem::path& plugin_dir,
                          const std::filesystem::path& private_key_path,
                          const std::string& signer,
                          std::string* error);

} // namespace misty::core
