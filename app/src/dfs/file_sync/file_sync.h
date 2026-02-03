#pragma once


#include <memory>
#include "dfs/client/misty_client.h"
#include <mutex>

#define MAX_SYNC_BUFFER_SIZE 2 * 1024 * 1024

namespace misty {
    class FileSync {
    public:
        FileSync(std::shared_ptr<MistyClient> client);
        virtual ~FileSync() = default;

        virtual void init_sync_resources() = 0;
        virtual void start_sync() = 0;

    protected:
        void on_file_created(const std::string& path, bool is_dir);
        void on_file_removed(const std::string& path, bool is_dir);
        void on_file_modified(const std::string& path, bool is_dir);
        void on_file_renamed(const std::string& path, bool is_dir);
    
    protected:
        std::shared_ptr<MistyClient> client_;
        std::thread sync_thread_;
        bool running_;
    };
}
