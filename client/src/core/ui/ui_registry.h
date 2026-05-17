#pragma once
#include <string>
#include <functional>
#include <unordered_map>
#include <mutex>
#include <memory>

namespace misty::core {
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
            if (states_.find(key) == states_.end()) {
                states_[key] = std::make_unique<T>();
            }
            T& state = static_cast<T&>(*states_[key]);
            if (callback) {
                callback(state);
            }
        }

        bool erase_state(const std::string& key) {
            std::lock_guard<std::mutex> lock(mu_);
            return states_.erase(key) > 0;
        }

        bool has_state(const std::string& key) const {
            std::lock_guard<std::mutex> lock(mu_);
            return states_.find(key) != states_.end();
        }

        std::size_t state_count() const {
            std::lock_guard<std::mutex> lock(mu_);
            return states_.size();
        }

    private:
        std::unordered_map<std::string, std::unique_ptr<UIState>> states_;
        mutable std::mutex mu_;
    };
}
