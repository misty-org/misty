#include "session_manager.h"
#include <iostream>

#ifdef __APPLE__
#include <Security/Security.h>
#else
#include "util.h"
#include <fstream>
#include <filesystem>
#endif

namespace misty::core {

#ifdef __APPLE__
    static const char* kService = "com.misty.app";
    static const char* kAccount = "jwt_token";

    // Helper to build the base Keychain query dictionary
    static CFMutableDictionaryRef create_keychain_query() {
        CFMutableDictionaryRef query = CFDictionaryCreateMutable(
            nullptr, 0,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks
        );

        CFStringRef service = CFStringCreateWithCString(nullptr, kService, kCFStringEncodingUTF8);
        CFStringRef account = CFStringCreateWithCString(nullptr, kAccount, kCFStringEncodingUTF8);

        CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
        CFDictionarySetValue(query, kSecAttrService, service);
        CFDictionarySetValue(query, kSecAttrAccount, account);
        CFDictionarySetValue(query, kSecUseDataProtectionKeychain, kCFBooleanTrue);

        CFRelease(service);
        CFRelease(account);

        return query;
    }
#endif

    SessionManager& SessionManager::get() {
        static SessionManager instance;
        return instance;
    }

    SessionManager::SessionManager() {
        load_token();
    }

    void SessionManager::load_token() {
#ifdef __APPLE__
        CFMutableDictionaryRef query = create_keychain_query();
        CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
        CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

        CFTypeRef result = nullptr;
        OSStatus status = SecItemCopyMatching(query, &result);
        CFRelease(query);

        std::cerr << "[SessionManager] load_token: SecItemCopyMatching status = " << status << std::endl;

        if (status == errSecSuccess && result) {
            CFDataRef data = (CFDataRef)result;
            token_ = std::string(
                reinterpret_cast<const char*>(CFDataGetBytePtr(data)),
                CFDataGetLength(data)
            );
            CFRelease(result);
            std::cerr << "[SessionManager] load_token: loaded token (" << token_.size() << " bytes)" << std::endl;
        } else {
            std::cerr << "[SessionManager] load_token: no token found" << std::endl;
        }
#endif
    }

    void SessionManager::save_token() const {
#ifdef __APPLE__
        // Remove any existing entry first
        delete_token();

        CFMutableDictionaryRef query = create_keychain_query();
        CFDataRef token_data = CFDataCreate(
            nullptr,
            reinterpret_cast<const UInt8*>(token_.c_str()),
            token_.size()
        );
        CFDictionarySetValue(query, kSecValueData, token_data);

        OSStatus status = SecItemAdd(query, nullptr);
        std::cerr << "[SessionManager] save_token: SecItemAdd status = " << status << std::endl;

        CFRelease(token_data);
        CFRelease(query);
#endif
    }

    void SessionManager::delete_token() const {
#ifdef __APPLE__
        CFMutableDictionaryRef query = create_keychain_query();
        SecItemDelete(query);
        CFRelease(query);
#endif
    }

    void SessionManager::set_token(const std::string& token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_ = token;
        save_token();
    }

    void SessionManager::clear_token() {
        std::lock_guard<std::mutex> lock(mu_);
        token_.clear();
        delete_token();
    }

    std::string SessionManager::get_token() const {
        std::lock_guard<std::mutex> lock(mu_);
        return token_;
    }

    bool SessionManager::is_authenticated() const {
        std::lock_guard<std::mutex> lock(mu_);
        return !token_.empty();
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
