#pragma once

#include "auth.grpc.pb.h"
#include <grpcpp/grpcpp.h>
#include <string>

namespace minidfs {

class AuthServiceImpl final : public AuthService::CallbackService {
public:
    explicit AuthServiceImpl(const std::string& jwt_secret);

    grpc::ServerUnaryReactor* Login(
        grpc::CallbackServerContext* context,
        const LoginReq* request,
        AuthRes* response) override;

    grpc::ServerUnaryReactor* Register(
        grpc::CallbackServerContext* context,
        const RegisterReqt* request,
        AuthRes* response) override;

private:
    std::string jwt_secret_;
};

}
