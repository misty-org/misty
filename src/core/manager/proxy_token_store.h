#pragma once

#include <optional>
#include <string>

namespace misty::core {

class ProxyTokenStore {
public:
    static ProxyTokenStore& get();

    std::optional<std::string> current_access_token() const;
    std::optional<std::string> current_or_refresh_access_token() const;
    bool refresh_access_token() const;

private:
    ProxyTokenStore() = default;
    ~ProxyTokenStore() = default;
    ProxyTokenStore(const ProxyTokenStore&) = delete;
    ProxyTokenStore& operator=(const ProxyTokenStore&) = delete;

    std::string database_path() const;
};

} // namespace misty::core
