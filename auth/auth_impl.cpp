#include "auth_impl.h"

namespace minidfs {

AuthServiceImpl::AuthServiceImpl(const std::string& jwt_secret) 
    : jwt_secret_(jwt_secret) {}

grpc::ServerUnaryReactor* AuthServiceImpl::Login(
    grpc::CallbackServerContext* context,
    const LoginRequest* request,
    AuthResponse* response) 
{
    class Reactor final : public grpc::ServerUnaryReactor {
    public:
        Reactor(const LoginRequest* req, AuthResponse* res, const std::string& secret) {
            // TODO: In a real app, verify against a DB or Firebase
            if (req->email() == "user@example.com" && req->password() == "password123") {
                res->set_success(true);
                res->set_token("mock_jwt_token_for_" + req->email()); 
            } else {
                res->set_success(false);
                res->set_error_msg("Invalid email or password");
            }
            this->Finish(grpc::Status::OK);
        }

        void OnDone() override { delete this; }
    };

    return new Reactor(request, response, jwt_secret_);
}

grpc::ServerUnaryReactor* AuthServiceImpl::Register(
    grpc::CallbackServerContext* context,
    const RegisterRequest* request,
    AuthResponse* response) 
{
    class Reactor final : public grpc::ServerUnaryReactor {
    public:
        Reactor(AuthResponse* res) {
            res->set_success(false);
            res->set_error_msg("Registration not implemented yet");
            this->Finish(grpc::Status::OK);
        }
        void OnDone() override { delete this; }
    };
    return new Reactor(response);
}

} // namespace minidfs
