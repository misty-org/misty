PROTOC=/opt/homebrew/bin/protoc
GRPC_WEB_PLUGIN=/opt/homebrew/bin/protoc-gen-grpc-web

$PROTOC -I=proto \
    --js_out=import_style=commonjs,binary:proto_src \
    --grpc-web_out=import_style=typescript,mode=grpcwebtext:proto_src \
    --plugin=protoc-gen-grpc-web=$GRPC_WEB_PLUGIN \
    proto/minidfs.proto