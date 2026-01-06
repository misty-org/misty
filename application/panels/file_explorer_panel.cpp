#include "file_explorer_panel.h"
#include <iostream>

namespace fs = std::filesystem;

namespace minidfs {
    
    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client) 
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        get_files(client_->GetClientMountPath());
    }

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        ImGui::Begin("File Explorer");

        // Attempt to lock.
        std::unique_lock<std::mutex> lock(state.mu, std::try_to_lock);

        if (lock.owns_lock()) {
            // Pass 'state' into these functions so they don't have to call registry_.get_state() again
            show_search_bar(state);
            ImGui::Separator();
            show_directory_contents(state);
            show_error_modal(state);
            
        }
        else {
            ImGui::Text("Syncing...");
        }

        ImGui::End();
    }

    void FileExplorerPanel::show_search_bar(FileExplorerState& state) {
        if (ImGui::BeginChild("FileExplorerSearchBar", ImVec2(0, 35), false)) {

            if (ImGui::Button("Home")) {
                get_files(client_->GetClientMountPath());
            }

            ImGui::SameLine();


            if (ImGui::InputText("Search", state.current_path, sizeof(state.current_path) - 1, ImGuiInputTextFlags_EnterReturnsTrue)) {
                get_files(state.current_path);
            }
        }
        ImGui::EndChild();
    }

    void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {

        // Table Flags: RowBg adds alternating row colors like Google Drive
        static ImGuiTableFlags flags = ImGuiTableFlags_Resizable | ImGuiTableFlags_Reorderable |
            ImGuiTableFlags_Hideable | ImGuiTableFlags_RowBg |
            ImGuiTableFlags_BordersOuter | ImGuiTableFlags_ScrollY;

        if (ImGui::BeginTable("FileTable", 4, flags)) {
            // 1. Setup Columns
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
			ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, 150.0f);
            ImGui::TableHeadersRow();

            if (state.files.empty()) {
                ImGui::TableNextRow();
                ImGui::TableNextColumn();
                float column_width = ImGui::GetColumnWidth();

                const char* text = "No files found...";
                float text_width = ImGui::CalcTextSize(text).x;
                float padding = (column_width - text_width) * 0.5f;
                if (padding > 0) {
                    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + padding);
                }
                ImGui::TextDisabled("%s", text);
            }
            else {
                for (int i = 0; i < (int)state.files.size(); i++) {
                    show_file_item(state, i);
                }
            }

            
            ImGui::EndTable();
        }
    }

    void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
        ImGuiIO& io = ImGui::GetIO();
        minidfs::FileInfo file = state.files[i];
        std::string display_name = fs::path(file.file_path()).filename().generic_string();

        // 1. Correct check (Always use full_path)
        bool is_currently_selected = state.selected_files.count(file.file_path()) > 0;

        ImGui::TableNextRow();
        ImGui::TableNextColumn();

        std::string label = (file.is_dir() ? "[DIR] " : "[FILE] ") + display_name;

        if (ImGui::Selectable(label.c_str(), is_currently_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick)) {

            if (io.KeyCtrl) {
                if (is_currently_selected) state.selected_files.erase(file.file_path());
                else state.selected_files.insert(file.file_path());
            }
            else if (io.KeyShift && state.last_selected_index != -1) {
                state.selected_files.clear();
                int start = std::min(state.last_selected_index, i);
                int end = std::max(state.last_selected_index, i);
                for (int j = start; j <= end; j++) state.selected_files.insert(state.files[j].file_path());
            }
            else {
                state.selected_files.clear();
                state.selected_files.insert(file.file_path());
            }
            state.last_selected_index = i;



            if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
                if (file.is_dir()) {
                    get_files(FileManager::ResolvePath(client_->GetClientMountPath(), file.file_path()).generic_string());
                }
                else {
                    open_file(FileManager::ResolveAbsolutePath(client_->GetClientMountPath(), file.file_path()).generic_string());
                }
            }
                
        }
    }

    
    void FileExplorerPanel::show_error_modal(FileExplorerState& state) {

        if (!state.error_msg.empty()) {
            ImGui::OpenPopup("Error Alert");
        }
        

        // Always define the popup window layout
        if (ImGui::BeginPopupModal("Error Alert", NULL, ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "SYSTEM ERROR");
            ImGui::Separator();
            ImGui::TextWrapped("%s", state.error_msg.c_str());
            ImGui::Spacing();

            if (ImGui::Button("OK", ImVec2(120, 0))) {
                // This is crucial: Clear the error message so it doesn't reopen immediately
                state.error_msg = "";
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndPopup();
        }
    }


    //gRPC client calls
        
    void FileExplorerPanel::get_files(const std::string& path) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        state.is_loading = true;
        auto client_ptr = client_;
        auto results = std::make_shared<std::vector<minidfs::FileInfo>>();

        worker_pool_.add(
            [client_ptr, path, results]() {
                if (client_ptr == nullptr) throw std::runtime_error("Not connected to MiniDFS");

                minidfs::ListFilesRes response;
                // Use the path passed from the UI
                grpc::StatusCode status = client_ptr->ListFiles(path, &response);

                if (status == grpc::StatusCode::OK || status == grpc::StatusCode::NOT_FOUND) {
                    for (const auto& file : response.files()) {
                        results->push_back(file);
                    }
                    return;
                }
                throw std::runtime_error("gRPC fetch failed");
            },
            [this, client_ptr, results, path]() {
                registry_.update_state<FileExplorerState>("FileExplorer", [path, client_ptr, results](FileExplorerState& s) mutable {
                    std::lock_guard<std::mutex> lock(s.mu);
                    s.update_files(path, std::move(*results));
                });
            },
            [this, results](const std::string& err_msg) {
                registry_.update_state<FileExplorerState>("FileExplorer", [results, err_msg](FileExplorerState& s) {
                    s.is_loading = false;
                    s.error_msg = err_msg;
                });
            }
        );
    }

    void FileExplorerPanel::add_file(const std::string& file_path) {
        registry_.update_state<FileExplorerState>("FileExplorer", [](FileExplorerState& s) {
            s.is_loading = true;
            s.error_msg = "";
        });

        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        auto client_ptr = client_;

        worker_pool_.add(
            [client_ptr, file_path]() {
                if (!client_ptr) throw std::runtime_error("gRPC Client lost");
                grpc::StatusCode status = client_ptr->StoreFile(file_path, file_path);
				if (status != grpc::StatusCode::OK) {
                    throw std::runtime_error("gRPC store file failed");
                }
            },
            [this]() {
                registry_.update_state<FileExplorerState>("FileExplorer", [](FileExplorerState& s) {
                    s.is_loading = false;
                    s.error_msg = "";
                });
            },
            [this](const std::string& err_msg) {
                registry_.update_state<FileExplorerState>("FileExplorer", [err_msg](FileExplorerState& s) {
                    s.is_loading = false;
                    s.error_msg = err_msg;
                });
            }
        );
    }
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>

    void FileExplorerPanel::open_file(const std::string& path) {
        ShellExecuteA(NULL, "open", path.c_str(), NULL, NULL, SW_SHOWNORMAL);
    }
#elif __APPLE__
    void FileExplorerPanel::open_file(const std::string& path) {
        std::string cmd = "open \"" + path + "\"";
        system(cmd.c_str());
    }
#elif __linux__
    void FileExplorerPanel::open_file(const std::string& path) {
        std::string cmd = "xdg-open \"" + path + "\"";
        system(cmd.c_str());
    }
#endif
}


