#pragma once

#include <string>
#include <vector>

namespace misty::panel {

struct PluginsActionProps {
    std::string label;
    std::string kind;
};

struct PluginsLinkProps {
    std::string label;
    std::string url;
};

struct PluginsDetailProps {
    std::string id;
    std::string name;
    std::string version;
    std::string author;
    std::string status;
    std::string overview;
    std::vector<std::string> capabilities;
    std::vector<std::string> where_it_appears;
    std::vector<std::string> permissions;
    std::vector<std::string> getting_started;
    std::vector<std::string> changelog;
    std::vector<PluginsLinkProps> links;
    std::vector<PluginsActionProps> actions;
};

} // namespace misty::panel
