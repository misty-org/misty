#include "session_manager.h"
#include <iostream>

#ifdef __APPLE__
#include <Security/Security.h>
#else
#include "util.h"
#include <fstream>
#include <filesystem>
#include <sys/stat.h>
#endif

namespace fs = std::filesystem;

namespace misty::core {

#ifdef __APPLE__
    static const char* kService = "com.misty.app";

    // Helper to build a Keychain query dictionary for a given account
    static CFMutableDictionaryRef create_keychain_query(const char* account) {
        CFMutableDictionaryRef query = CFDictionaryCreateMutable(
            nullptr, 0,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks
        );

        CFStringRef service = CFStringCreateWithCString(nullptr, kService, kCFStringEncodingUTF8);
        CFStringRef acct = CFStringCreateWithCString(nullptr, account, kCFStringEncodingUTF8);

        CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
        CFDictionarySetValue(query, kSecAttrService, service);
        CFDictionarySetValue(query, kSecAttrAccount, acct);
        // kSecUseDataProtectionKeychain requires sandbox entitlements and will
        // silently fail on unsigned/dev builds — use the standard login keychain.

        CFRelease(service);
        CFRelease(acct);

        return query;
    }

    static std::string load_keychain_item(const char* account) {
        CFMutableDictionaryRef query = create_keychain_query(account);
        CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
        CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

        CFTypeRef result = nullptr;
        OSStatus status = SecItemCopyMatching(query, &result);
        CFRelease(query);

        if (status == errSecSuccess && result) {
            CFDataRef data = (CFDataRef)result;
            std::string value(
                reinterpret_cast<const char*>(CFDataGetBytePtr(data)),
                CFDataGetLength(data)
            );
            CFRelease(result);
            return value;
        }
        return "";
    }

    static void save_keychain_item(const char* account, const std::string& value) {
        // Delete existing entry first
        CFMutableDictionaryRef del_query = create_keychain_query(account);
        SecItemDelete(del_query);
        CFRelease(del_query);

        CFMutableDictionaryRef query = create_keychain_query(account);
        CFDataRef data = CFDataCreate(
            nullptr,
            reinterpret_cast<const UInt8*>(value.c_str()),
            value.size()
        );
        CFDictionarySetValue(query, kSecValueData, data);

        SecItemAdd(query, nullptr);

        CFRelease(data);
        CFRelease(query);
    }

    static void delete_keychain_item(const char* account) {
        CFMutableDictionaryRef query = create_keychain_query(account);
        SecItemDelete(query);
        CFRelease(query);
    }
#else
    static fs::path get_misty_dir() {
        std::string home = get_user_home_dir();
        return fs::path(home) / ".misty";
    }

    static fs::path get_token_path() {
        return get_misty_dir() / "token";
    }

    static fs::path get_refresh_token_path() {
        return get_misty_dir() / "refresh_token";
    }

    static void ensure_misty_dir() {
        fs::path dir = get_misty_dir();
        if (!fs::exists(dir)) {
            fs::create_directories(dir);
            chmod(dir.c_str(), 0700);
        }
    }

    static std::string read_file_token(const fs::path& path) {
        if (!fs::exists(path)) return "";
        std::ifstream file(path);
        std::string value;
        if (file.is_open()) {
            std::getline(file, value);
            file.close();
        }
        return value;
    }

    static void write_file_token(const fs::path& path, const std::string& value) {
        ensure_misty_dir();
        std::ofstream file(path);
        if (file.is_open()) {
            file << value;
            file.close();
            chmod(path.c_str(), 0600);
        }
    }

    static void remove_file_token(const fs::path& path) {
        if (fs::exists(path)) {
            fs::remove(path);
        }
    }
#endif

    SessionManager& SessionManager::get() {
        static SessionManager instance;
        return instance;
    }

    SessionManager::SessionManager() {
        load_tokens();
    }

    void SessionManager::load_tokens() {
#ifdef __APPLE__
        token_ = load_keychain_item("jwt_token");
        refresh_token_ = load_keychain_item("refresh_token");
#else
        token_ = read_file_token(get_token_path());
        refresh_token_ = read_file_token(get_refresh_token_path());
#endif
        if (!token_.empty()) {
            std::cerr << "[SessionManager] load_tokens: loaded access token (" << token_.size() << " bytes)" << std::endl;
        }
        if (!refresh_token_.empty()) {
            std::cerr << "[SessionManager] load_tokens: loaded refresh token (" << refresh_token_.size() << " bytes)" << std::endl;
        }
    }

    void SessionManager::save_tokens() const {
#ifdef __APPLE__
        save_keychain_item("jwt_token", token_);
        save_keychain_item("refresh_token", refresh_token_);
#else
        write_file_token(get_token_path(), token_);
        write_file_token(get_refresh_token_path(), refresh_token_);
#endif
        std::cerr << "[SessionManager] save_tokens: persisted both tokens" << std::endl;
    }

    void SessionManager::delete_tokens() const {
#ifdef __APPLE__
        delete_keychain_item("jwt_token");
        delete_keychain_item("refresh_token");
#else
        remove_file_token(get_token_path());
        remove_file_token(get_refresh_token_path());
#endif
        std::cerr << "[SessionManager] delete_tokens: removed all tokens" << std::endl;
    }

    void SessionManager::set_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_ = access_token;
        refresh_token_ = refresh_token;
        save_tokens();
    }

    void SessionManager::update_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_ = access_token;
        refresh_token_ = refresh_token;
        save_tokens();
    }

    void SessionManager::clear_token() {
        std::lock_guard<std::mutex> lock(mu_);
        token_.clear();
        refresh_token_.clear();
        delete_tokens();
    }

    std::string SessionManager::get_token() const {
        std::lock_guard<std::mutex> lock(mu_);
        return token_;
    }

    std::string SessionManager::get_refresh_token() const {
        std::lock_guard<std::mutex> lock(mu_);
        return refresh_token_;
    }

    bool SessionManager::is_authenticated() const {
        std::lock_guard<std::mutex> lock(mu_);
        return !token_.empty();
    }

    void SessionManager::mark_session_expired() {
        std::lock_guard<std::mutex> lock(mu_);
        session_expired_ = true;
        std::cerr << "[SessionManager] session expired — user must re-authenticate" << std::endl;
    }

    bool SessionManager::is_session_expired() const {
        std::lock_guard<std::mutex> lock(mu_);
        return session_expired_;
    }

    void SessionManager::clear_session_expired() {
        std::lock_guard<std::mutex> lock(mu_);
        session_expired_ = false;
    }

    std::map<std::string, std::string> SessionManager::get_auth_headers() const {
        std::lock_guard<std::mutex> lock(mu_);
        std::map<std::string, std::string> headers;
        if (!token_.empty()) {
            headers["Authorization"] = "Bearer " + token_;
        }
        return headers;
    }

}
