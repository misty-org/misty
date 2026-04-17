set(ROOT_DIR ${CMAKE_SOURCE_DIR}/..)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)

set(PROTO_FILE ${ROOT_DIR}/proto/misty.proto)
set(GEN_PATH ${CMAKE_SOURCE_DIR}/src/proto_src)
file(MAKE_DIRECTORY ${GEN_PATH})

set(PROTOC_BIN $<TARGET_FILE:protobuf::protoc>)
set(GRPC_CPP_PLUGIN $<TARGET_FILE:gRPC::grpc_cpp_plugin>)

set(GEN_FILES 
    "${GEN_PATH}/misty.pb.h" "${GEN_PATH}/misty.pb.cc"
    "${GEN_PATH}/misty.grpc.pb.h" "${GEN_PATH}/misty.grpc.pb.cc"
)

add_custom_command(
    OUTPUT ${GEN_FILES}
    COMMAND ${PROTOC_BIN} --cpp_out=${GEN_PATH} --grpc_out=${GEN_PATH}
            --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
            -I ${ROOT_DIR}/proto ${PROTO_FILE}
    DEPENDS ${PROTO_FILE} protobuf::protoc gRPC::grpc_cpp_plugin
    COMMENT "Generating gRPC and Proto files"
)

add_custom_target(misty_proto DEPENDS ${GEN_FILES})

# --- 2. Combined Library ---
file(GLOB_RECURSE MINIDFS_SRCS
    "src/dfs/*.cpp"
    "src/dfs/*.h"
)

add_library(misty_core STATIC ${MINIDFS_SRCS} ${GEN_FILES})
add_dependencies(misty_core misty_proto)

# --- 3. Clean Scoped Includes ---
target_include_directories(misty_core 
    PUBLIC 
        ${CMAKE_SOURCE_DIR}/src # Use one root
        $<BUILD_INTERFACE:${GEN_PATH}> # Allow finding generated headers
)

# --- 4. Linking ---
target_link_libraries(misty_core PUBLIC
    protobuf::libprotobuf
    gRPC::grpc++
)