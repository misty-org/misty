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

# Release build: strip DWARF + symbol table (-s -w) and trim embedded build
# paths (-trimpath). Cuts ~30% off the proxy binary. Use for DMG builds;
# dev builds should stay on `make build` so stack traces stay readable.
# misty-pwd-helper is not built here — it's only useful alongside restic,
# which is not bundled (vault is a plugin, not core).
.PHONY: release
release:
	mkdir -p dist
	go build -trimpath -ldflags="-s -w" -o dist/misty-proxy .