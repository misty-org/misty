generate:
	protoc \
	--plugin=protoc-gen-go=$(shell go env GOPATH)/bin/protoc-gen-go \
    --plugin=protoc-gen-go-grpc=$(shell go env GOPATH)/bin/protoc-gen-go-grpc \
	--go_out=./proto_src \
	--go-grpc_out=./proto_src \
	--proto_path=../proto minidfs.proto