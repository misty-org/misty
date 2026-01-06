# cmake/setup_proto.cmake

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)
find_package(absl CONFIG REQUIRED)

set(PROTO_FILE ${CMAKE_SOURCE_DIR}/proto/minidfs.proto)
set(GEN_PATH ${CMAKE_SOURCE_DIR}/proto_src)
file(MAKE_DIRECTORY ${GEN_PATH})

# Get vcpkg paths
get_target_property(PROTOC_BIN protobuf::protoc LOCATION)
get_target_property(GRPC_CPP_PLUGIN gRPC::grpc_cpp_plugin LOCATION)

# Generated files
set(PROTO_HDRS ${GEN_PATH}/minidfs.pb.h)
set(PROTO_SRCS ${GEN_PATH}/minidfs.pb.cc)
set(GRPC_HDRS ${GEN_PATH}/minidfs.grpc.pb.h)
set(GRPC_SRCS ${GEN_PATH}/minidfs.grpc.pb.cc)

# --- Protobuf C++ ---
add_custom_command(
    OUTPUT ${PROTO_SRCS} ${PROTO_HDRS}
    COMMAND ${PROTOC_BIN}
        --cpp_out=${GEN_PATH}
        -I ${CMAKE_SOURCE_DIR}/proto
        ${PROTO_FILE}
    DEPENDS ${PROTO_FILE}
    COMMENT "Generating C++ protobuf files"
)

# --- gRPC ---
add_custom_command(
    OUTPUT ${GRPC_SRCS} ${GRPC_HDRS}
    COMMAND ${PROTOC_BIN}
        --grpc_out=${GEN_PATH}
        --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
        -I ${CMAKE_SOURCE_DIR}/proto
        ${PROTO_FILE}
    DEPENDS ${PROTO_FILE}
    COMMENT "Generating gRPC C++ files"
)

# --- Proto library ---
add_library(minidfs_proto STATIC
    ${PROTO_SRCS}
    ${PROTO_HDRS}
    ${GRPC_SRCS}
    ${GRPC_HDRS}
)

set_source_files_properties(
    ${PROTO_SRCS} ${PROTO_HDRS} ${GRPC_SRCS} ${GRPC_HDRS}
    PROPERTIES GENERATED TRUE
)

target_include_directories(minidfs_proto PUBLIC ${GEN_PATH})

target_link_libraries(minidfs_proto PUBLIC
    protobuf::libprotobuf
    gRPC::grpc++
    absl::status
    absl::strings
    absl::synchronization
)
