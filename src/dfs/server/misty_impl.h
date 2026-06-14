#pragma once

#include <grpcpp/grpcpp.h>
#include <atomic>
#include <queue>
#include "proto_src/misty.grpc.pb.h"
#include "dfs/file_manager.h"
#include "pubsub_manager.h"

class MistyImpl final : public misty::MistyService::CallbackService {
public:
    explicit MistyImpl(const std::string& mount_path);

    grpc::ServerUnaryReactor* ListFiles(
        grpc::CallbackServerContext* context, 
        const misty::ListFilesReq* request, 
        misty::ListFilesRes* response) override;

    grpc::ServerUnaryReactor* GetFileLock(
        grpc::CallbackServerContext* context, 
        const misty::FileLockReq* request, 
        misty::FileLockRes* response) override;

    grpc::ServerUnaryReactor* RemoveFile(
        grpc::CallbackServerContext* context, 
        const misty::DeleteFileReq* request, 
        misty::DeleteFileRes* response) override;

    grpc::ServerReadReactor<misty::FileBuffer>* StoreFile(
        grpc::CallbackServerContext* context, 
        misty::StoreFileRes* response) override;

    grpc::ServerWriteReactor<misty::FileBuffer>* FetchFile(
        grpc::CallbackServerContext* context, 
        const misty::FetchFileReq* request) override;
    
    grpc::ServerWriteReactor<misty::FileUpdate>* FileUpdateCallback(
        grpc::CallbackServerContext* context, 
        const misty::FileUpdate* request) override;

    std::atomic<uint64_t> LoadVersion() const {
        return version_.load();
    }

    void IncrementVersion() {
        version_.fetch_add(1);
    }

    void SetVersion(uint64_t new_version) {
        version_.store(new_version);
    }
    
private:
    std::unique_ptr<FileManager> file_manager_;
    std::unique_ptr<PubSubManager> pubsub_manager_;
    std::string mount_path_;
    std::atomic<uint64_t> version_;


    friend class MistySingleClientTest;
    friend class MistyMultiClientTest;
};
