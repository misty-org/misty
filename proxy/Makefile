generate:
	protoc \
	--plugin=protoc-gen-go=$(shell go env GOPATH)/bin/protoc-gen-go \
    --plugin=protoc-gen-go-grpc=$(shell go env GOPATH)/bin/protoc-gen-go-grpc \
	--go_out=./proto_src \
	--go-grpc_out=./proto_src \
	--proto_path=../proto minidfs.proto

# Build the proxy and the misty-pwd-helper side-by-side. They live in the
# same dist/ dir so HelperBinaryPath() can find the helper next to the
# running proxy executable without any extra configuration.
.PHONY: build
build:
	mkdir -p dist
	go build -o dist/misty-proxy .
	go build -o dist/misty-pwd-helper ./cmd/misty-pwd-helper