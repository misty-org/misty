#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace misty::core {

class OpenWithManager {
public:
    static OpenWithManager& get();

    std::optional<std::string> association_for_path(const std::string& file_path);
    void set_association_for_path(const std::string& file_path, const std::string& application_path);

private:
    OpenWithManager() = default;
    ~OpenWithManager() = default;
    OpenWithManager(const OpenWithManager&) = delete;
    OpenWithManager& operator=(const OpenWithManager&) = delete;

    void load_if_needed();
    void save() const;
    std::string association_key_for_path(const std::string& file_path) const;
    std::string storage_path() const;

    mutable std::mutex mu_;
    mutable bool loaded_ = false;
    std::unordered_map<std::string, std::string> associations_;
};

} // namespace misty::core
