PROTOC=/opt/homebrew/bin/protoc
SWIFT_PLUGIN=/opt/homebrew/bin/protoc-gen-swift
GRPC_SWIFT_PLUGIN=/opt/homebrew/bin/protoc-gen-grpc-swift-2

$PROTOC -I=proto \
    --swift_out=proto_src \
    --swift_opt=Visibility=Public \
    --grpc-swift_out=proto_src \
    --grpc-swift_opt=Visibility=Public \
    --plugin=protoc-gen-swift=$SWIFT_PLUGIN \
    --plugin=protoc-gen-grpc-swift=$GRPC_SWIFT_PLUGIN \
    proto/minidfs.proto
