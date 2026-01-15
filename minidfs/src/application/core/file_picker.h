#pragma once
#include <vector>
#include <string>
#include <filesystem>

namespace fs = std::filesystem;

namespace minidfs::core {
    struct FilePickerOptions {
        std::string title = "minidfs - Select Files";
        std::string default_directory = "";
        std::vector<std::string> allowed_extensions;
        bool show_hidden_files = false;
    }
    struct FilePickerResult {
        bool success = false;
        std::vector<std::string> paths;

        bool has_selection() const {
            return success && !paths.empty();
        }

        size_t count() const {
            return paths.size();
        }

        std::vector<fs::path> as_paths() const {
            std::vector<fs::path> result;
            for (const auto& p : paths) {
                result.push_back(fs::path(p));
            }
            return result;
        }

    }

    class FilePicker {
    public:
    #ifdef __APPLE__
        static FilePickerResult show_dialog(const FilePickerOptions& options);
    #elif _WIN32
        static FilePickerResult show_dialog(const FilePickerOptions& options);
    #elif __linux__
        static FilePickerResult show_dialog(const FilePickerOptions& options);
    #endif
    }

}