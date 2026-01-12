#pragma once
#include <string>
#include <functional>
#include <unordered_map>
#include <mutex>
#include <memory>

namespace minidfs {
    struct UIState {
        virtual ~UIState() = default;
    };

    class UIRegistry {
    public:
        template<typename T>
        T& get_state(const std::string& key) {
            std::lock_guard<std::mutex> lock(mu_);
            if (states_.find(key) == states_.end()) {
                states_[key] = std::make_unique<T>();
            }
            return static_cast<T&>(*states_[key]);
        }

        template<typename T>
        void update_state(const std::string& key, std::function<void(T&)> callback) {
            std::lock_guard<std::mutex> lock(mu_);
            // Don't call get_state - directly access to avoid double lock
            if (states_.find(key) == states_.end()) {
                states_[key] = std::make_unique<T>();
            }
            T& state = static_cast<T&>(*states_[key]);
            if (callback) {
                callback(state);
            }
        }

    private:
        std::unordered_map<std::string, std::unique_ptr<UIState>> states_;
        std::mutex mu_; // Changed from recursive_mutex
    };
}