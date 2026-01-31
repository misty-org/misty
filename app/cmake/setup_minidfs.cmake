set(ROOT_DIR ${CMAKE_SOURCE_DIR}/..)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)

set(PROTO_FILE ${ROOT_DIR}/proto/minidfs.proto)
set(GEN_PATH ${CMAKE_SOURCE_DIR}/src/proto_src)
file(MAKE_DIRECTORY ${GEN_PATH})

set(PROTOC_BIN $<TARGET_FILE:protobuf::protoc>)
set(GRPC_CPP_PLUGIN $<TARGET_FILE:gRPC::grpc_cpp_plugin>)

set(GEN_FILES 
    "${GEN_PATH}/minidfs.pb.h" "${GEN_PATH}/minidfs.pb.cc"
    "${GEN_PATH}/minidfs.grpc.pb.h" "${GEN_PATH}/minidfs.grpc.pb.cc"
)

add_custom_command(
    OUTPUT ${GEN_FILES}
    COMMAND ${PROTOC_BIN} --cpp_out=${GEN_PATH} --grpc_out=${GEN_PATH}
            --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
            -I ${ROOT_DIR}/proto ${PROTO_FILE}
    DEPENDS ${PROTO_FILE} protobuf::protoc gRPC::grpc_cpp_plugin
    COMMENT "Generating gRPC and Proto files"
)

add_custom_target(minidfs_proto DEPENDS ${GEN_FILES})

# --- 2. Combined Library ---
file(GLOB_RECURSE MINIDFS_SRCS
    "src/dfs/*.cpp"
    "src/dfs/*.h"
    ${GEN_FILES}
)

add_library(minidfs STATIC ${MINIDFS_SRCS})
add_dependencies(minidfs minidfs_proto)

# --- 3. Clean Scoped Includes ---
target_include_directories(minidfs 
    PUBLIC 
        ${CMAKE_SOURCE_DIR}/src # Use one root
        $<BUILD_INTERFACE:${GEN_PATH}> # Allow finding generated headers
)

# --- 4. Linking ---
target_link_libraries(minidfs PUBLIC
    protobuf::libprotobuf
    gRPC::grpc++
)