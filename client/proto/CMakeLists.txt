set(MISTY_PROTO_FILE "${CMAKE_CURRENT_SOURCE_DIR}/misty.proto")
set(MISTY_PROTO_GEN_DIR "${CMAKE_SOURCE_DIR}/src/proto_src")

set(MISTY_PROTO_GENERATED_FILES
    "${MISTY_PROTO_GEN_DIR}/misty.pb.h"
    "${MISTY_PROTO_GEN_DIR}/misty.pb.cc"
    "${MISTY_PROTO_GEN_DIR}/misty.grpc.pb.h"
    "${MISTY_PROTO_GEN_DIR}/misty.grpc.pb.cc"
)

file(MAKE_DIRECTORY "${MISTY_PROTO_GEN_DIR}")
set_source_files_properties(${MISTY_PROTO_GENERATED_FILES} PROPERTIES GENERATED TRUE)

add_custom_command(
    OUTPUT ${MISTY_PROTO_GENERATED_FILES}
    COMMAND ${CMAKE_COMMAND} -E make_directory "${MISTY_PROTO_GEN_DIR}"
    COMMAND $<TARGET_FILE:protobuf::protoc>
            --cpp_out=${MISTY_PROTO_GEN_DIR}
            --grpc_out=${MISTY_PROTO_GEN_DIR}
            --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
            -I ${CMAKE_CURRENT_SOURCE_DIR}
            ${MISTY_PROTO_FILE}
    DEPENDS "${MISTY_PROTO_FILE}" protobuf::protoc gRPC::grpc_cpp_plugin
    COMMENT "Generating gRPC and Proto files"
    VERBATIM
)

add_library(misty_proto STATIC ${MISTY_PROTO_GENERATED_FILES})
target_include_directories(misty_proto
    PUBLIC
        "${CMAKE_SOURCE_DIR}/src"
        "${MISTY_PROTO_GEN_DIR}"
)
target_link_libraries(misty_proto
    PUBLIC
        protobuf::libprotobuf
        gRPC::grpc++
)
