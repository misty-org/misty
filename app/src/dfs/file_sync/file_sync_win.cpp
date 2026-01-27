#ifdef _WIN32

#include "file_sync_win.h"
#include "dfs/file_manager.h"
#include <filesystem>


namespace fs = std::filesystem;

namespace minidfs {
    FileSyncWin32::FileSyncWin32(std::shared_ptr<MiniDFSClient> client)
        : FileSync(std::move(client)) {
        
    }

    FileSyncWin32::~FileSyncWin32() {
        running_ = false;
        if (stop_signal_ != NULL) {
            SetEvent(stop_signal_);
        }
        if (directory_handle_ != INVALID_HANDLE_VALUE) {
            CancelIo(directory_handle_); 
        }

        if (sync_thread_.joinable()) {
            sync_thread_.join();
        }

        if (directory_handle_ != INVALID_HANDLE_VALUE) CloseHandle(directory_handle_);
        if (overlapped_.hEvent != NULL) CloseHandle(overlapped_.hEvent);
        if (stop_signal_ != NULL) CloseHandle(stop_signal_);
    }

    void FileSyncWin32::init_sync_resources() {
        if (client_ == nullptr) {
            throw std::runtime_error("MiniDFSClient is not initialized");
        }
        stop_signal_ = CreateEvent(NULL, TRUE, FALSE, NULL);
		std::cout << client_->GetClientMountPath() << std::endl;
        directory_handle_ = CreateFile(
            client_->GetClientMountPath().c_str(),
            FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            NULL,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
            NULL
        );
        if (directory_handle_ == INVALID_HANDLE_VALUE) {
            throw std::runtime_error("Failed to open directory handle for monitoring");
        }
        overlapped_.hEvent = CreateEvent(NULL, TRUE, FALSE, NULL);
        if (overlapped_.hEvent == NULL) {
            throw std::runtime_error("Failed to create overlapped event");
        }
    }

     void FileSyncWin32::start_sync() {
        running_ = true;
        sync_thread_ = std::thread(&FileSyncWin32::sync_loop, this);
    }

    void FileSyncWin32::sync_loop() {
        while (running_) {
            ResetEvent(overlapped_.hEvent);
            
            BOOL success = ReadDirectoryChangesW(
                directory_handle_,
                buffer_,
                MAX_SYNC_BUFFER_SIZE,
                TRUE,
                FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_LAST_WRITE,
                NULL,
                &overlapped_,
                NULL
            );
            if (!success) {
                DWORD error = GetLastError();
                if (error != ERROR_IO_PENDING) {
                    throw std::runtime_error("ReadDirectoryChangesW failed with error: " + std::to_string(error));
                }
            }

            HANDLE wait_handles[] = { overlapped_.hEvent, stop_signal_ };
            DWORD wait_status = WaitForMultipleObjects(2, wait_handles, FALSE, INFINITE);

            if (wait_status == WAIT_OBJECT_0) {
                if (GetOverlappedResult(directory_handle_, &overlapped_, &bytes_transferred_, FALSE)) {
                    handle_change();
                }
            } else if (wait_status == WAIT_OBJECT_0 + 1) {
                break; 
            }
        }
    }

    void FileSyncWin32::handle_change() {
        if (bytes_transferred_ == 0) handle_overflow();
        uint8_t* p_curr = reinterpret_cast<uint8_t*>(buffer_);

        while (true) {
            auto* p_notify = reinterpret_cast<FILE_NOTIFY_INFORMATION*>(p_curr);
            std::wstring file_name(p_notify->FileName, p_notify->FileNameLength / sizeof(WCHAR));

            std::u8string file_path = fs::path(file_name).u8string();
            std::string path(file_path.begin(), file_path.end());
            bool is_dir = fs::is_directory(path);

            switch (p_notify->Action) {
            case FILE_ACTION_ADDED:
                on_file_created(path, is_dir);
                break;
            }

            if (p_notify->NextEntryOffset == 0) {
                break;
            }

            p_curr += p_notify->NextEntryOffset;
        }
    }

    void FileSyncWin32::handle_overflow() {
        std::cout << "Overflow detected in file change notifications." << std::endl;
    }

}


#endif






