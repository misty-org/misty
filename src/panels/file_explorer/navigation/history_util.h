#pragma once

#include <stack>
#include <string>

namespace misty::panel {

/**
 * @brief Normalizes a path into the stable representation stored in navigation history.
 */
std::string normalize_history_path(const std::string& path);

/**
 * @brief Returns true when two paths refer to the same history location.
 */
bool same_history_path(const std::string& lhs, const std::string& rhs);

/**
 * @brief Pushes a path onto a navigation history stack when it is usable and distinct.
 */
void push_history_path(std::stack<std::string>& history, const std::string& path);

}  // namespace misty::panel
