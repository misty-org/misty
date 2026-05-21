#include "panels/file_explorer/state/file_sidebar_state.h"

#include <fstream>
#include <iostream>

namespace misty::panel {

void create_file(const std::string& file_path) {
    std::cout << "creating file at: " << file_path << std::endl;
    std::ofstream file(file_path);
}

}  // namespace misty::panel
