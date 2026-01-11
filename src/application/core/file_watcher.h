#ifdef __APPLE__
#pragma once

#include "minidfs_client.h"
#include <CoreServices/CoreServices.h>
#include <vector>
#include <string>

namespace minidfs::core {
    enum class FILE_CHANGE_EVENT {
        FILE_CREATED,
        FILE_DELETED,
        FILE_MODIFIED,
        FILE_RENAMED
    };
    class FileWatcher {
    public:
        void start_watching(const std::string& path);
        void stop_watching();
    private:
        static void file_watcher_callback(
                ConstFSEventStreamRef streamRef,
                void *clientCallBackInfo,
                size_t numEvents,
                void *eventPaths,
                const FSEventStreamEventFlags eventFlags[],
                const FSEventStreamEventId eventIds[]);
        void handle_events(size_t numEvents, char **eventPaths, const FSEventStreamEventFlags eventFlags[]);
        void on_file_created(const std::string& path, bool is_dir);
        void on_file_removed(const std::string& path, bool is_dir);
        void on_file_modified(const std::string& path, bool is_dir);
        void on_file_renamed(const std::string& path, bool is_dir);
    
    private:
        FSEventStreamRef stream_;
        std::shared_ptr<MiniDFSClient> client_;
    };
   
    
}
#endif