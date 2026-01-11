#ifdef __APPLE__
#include "file_watcher.h"

//Checkout apple FS events docs here: https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html#//apple_ref/doc/uid/TP40005289-CH4-SW4

namespace minidfs::core {
    void FileWatcher::start_watching(const std::string& path) {
        std::cout << "Starting file watcher on path: " << path << std::endl;
        CFStringRef cfPath = CFStringCreateWithCString(NULL, path.c_str(), kCFStringEncodingUTF8);
        CFArrayRef pathsToWatch = CFArrayCreate(NULL, (const void **)&cfPath, 1, NULL);

        FSEventStreamContext context = {0, (void*)this, NULL, NULL, NULL};

        stream_ = FSEventStreamCreate(
            NULL, &FileWatcher::file_watcher_callback, &context, pathsToWatch,
            kFSEventStreamEventIdSinceNow, 0.5, kFSEventStreamCreateFlagFileEvents
        );

        dispatch_queue_t dq = dispatch_queue_create("com.minidfs.watcher", DISPATCH_QUEUE_SERIAL);
        FSEventStreamSetDispatchQueue(stream_, dq);

        FSEventStreamStart(stream_);
        CFRelease(pathsToWatch);
        CFRelease(cfPath);
    }

    void FileWatcher::stop_watching() {
        FSEventStreamStop(stream_);
        FSEventStreamInvalidate(stream_);
        FSEventStreamRelease(stream_);
    }

    void FileWatcher::file_watcher_callback(ConstFSEventStreamRef streamRef,
        void *clientCallBackInfo,
        size_t numEvents,
        void *eventPaths,
        const FSEventStreamEventFlags eventFlags[],
        const FSEventStreamEventId eventIds[]) 
    {
        FileWatcher* watcher = static_cast<FileWatcher*>(clientCallBackInfo);
        watcher->handle_events(numEvents, (char **)eventPaths, eventFlags);
    }

    void FileWatcher::handle_events(size_t numEvents, char **eventPaths, const FSEventStreamEventFlags eventFlags[]) {
        for (size_t i = 0; i < numEvents; ++i) {
            std::string path(eventPaths[i]);
            bool is_dir = (eventFlags[i] & kFSEventStreamEventFlagItemIsDir) != 0;

            if (eventFlags[i] & kFSEventStreamEventFlagItemCreated) {
                on_file_created(path, is_dir);
            } else if (eventFlags[i] & kFSEventStreamEventFlagItemRemoved) {
                on_file_removed(path, is_dir);
            } else if (eventFlags[i] & kFSEventStreamEventFlagItemModified) {
                on_file_modified(path, is_dir);
            } else if (eventFlags[i] & kFSEventStreamEventFlagItemRenamed) {
                on_file_renamed(path, is_dir);
            }
        }
    }

    void FileWatcher::on_file_created(const std::string& path, bool is_dir) {
        /*
         grpc::StatusCode status = client_->StoreFile("client", path);
        if (status != grpc::StatusCode::OK) {
            std::cerr << "Error storing file " << path << ": " << static_cast<int>(status) << std::endl;
        }
        */
       std::cout << "File created: " << path << " Is Directory: " << is_dir << std::endl;
       
    }

    void FileWatcher::on_file_removed(const std::string& path, bool is_dir) {
        
    }

    void FileWatcher::on_file_modified(const std::string& path, bool is_dir) {
        
    }

    void FileWatcher::on_file_renamed(const std::string& path, bool is_dir) {
        
    }

}
#endif