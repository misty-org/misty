#pragma once

#ifdef __linux__
#include <iostream>
#include "file_sync.h"

namespace minidfs {
    class FileSyncLinux : public FileSync {
    public:
        FileSyncLinux(std::shared_ptr<MiniDFSClient> client);
        ~FileSyncLinux();

        void init_sync_resources() override;
        void start_sync() override;

    private:
        void sync_loop();
        void handle_events();

    private:
        int inotify_fd_ = -1;
        int watch_fd_ = -1;
    };
}
#endif
