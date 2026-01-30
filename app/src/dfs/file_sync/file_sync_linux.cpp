#ifdef __linux__

#include "file_sync_linux.h"
#include <sys/inotify.h>
#include <unistd.h>
#include <cstring>
#include <vector>
#include <string>

namespace minidfs {
    FileSyncLinux::FileSyncLinux(std::shared_ptr<MiniDFSClient> client)
        : FileSync(std::move(client)), inotify_fd_(-1), watch_fd_(-1) {
    }

    FileSyncLinux::~FileSyncLinux() {
        running_ = false;
        if (sync_thread_.joinable()) {
            sync_thread_.join();
        }
        if (watch_fd_ >= 0) {
            inotify_rm_watch(inotify_fd_, watch_fd_);
        }
        if (inotify_fd_ >= 0) {
            close(inotify_fd_);
        }
    }

    void FileSyncLinux::init_sync_resources() {
        std::cout << "Starting file watcher on path: " << client_->GetClientMountPath() << std::endl;

        inotify_fd_ = inotify_init();
        if (inotify_fd_ < 0) {
            throw std::runtime_error("Failed to initialize inotify");
        }

        watch_fd_ = inotify_add_watch(inotify_fd_, client_->GetClientMountPath().c_str(),
            IN_CREATE | IN_DELETE | IN_MODIFY | IN_MOVED_FROM | IN_MOVED_TO);
        if (watch_fd_ < 0) {
            close(inotify_fd_);
            inotify_fd_ = -1;
            throw std::runtime_error("Failed to add inotify watch");
        }
    }

    void FileSyncLinux::start_sync() {
        running_ = true;
        sync_thread_ = std::thread(&FileSyncLinux::sync_loop, this);
    }

    void FileSyncLinux::sync_loop() {
        constexpr size_t BUF_LEN = 4096;
        char buf[BUF_LEN] __attribute__((aligned(__alignof__(struct inotify_event))));

        while (running_) {
            ssize_t len = read(inotify_fd_, buf, BUF_LEN);
            if (len <= 0) break;

            for (char* ptr = buf; ptr < buf + len; ) {
                auto* event = reinterpret_cast<struct inotify_event*>(ptr);
                handle_events();

                if (event->len > 0) {
                    std::string path = client_->GetClientMountPath() + "/" + event->name;
                    bool is_dir = (event->mask & IN_ISDIR) != 0;

                    if (event->mask & IN_CREATE) {
                        on_file_created(path, is_dir);
                    } else if (event->mask & IN_DELETE) {
                        on_file_removed(path, is_dir);
                    } else if (event->mask & IN_MODIFY) {
                        on_file_modified(path, is_dir);
                    } else if (event->mask & (IN_MOVED_FROM | IN_MOVED_TO)) {
                        on_file_renamed(path, is_dir);
                    }
                }

                ptr += sizeof(struct inotify_event) + event->len;
            }
        }
    }

    void FileSyncLinux::handle_events() {
        // Event handling is done inline in sync_loop
    }
}

#endif
