# cmake/vendor.cmake
list(APPEND CMAKE_PREFIX_PATH "${CMAKE_SOURCE_DIR}/vendor/minidfs_sdk/Release")
list(APPEND CMAKE_PREFIX_PATH "${CMAKE_SOURCE_DIR}/vendor/minidfs_sdk/Debug")

find_package(gRPC CONFIG QUIET)
find_package(Protobuf CONFIG QUIET)

if(NOT gRPC_FOUND OR NOT Protobuf_FOUND)
    message(FATAL_ERROR 
        "\n--- DEPENDENCY MISSING ---\n"
        "gRPC or Protobuf not found! Please install them using vcpkg:\n"
        "  vcpkg install grpc:x64-windows\n"
        "Then run CMake again with:\n"
        "  -DCMAKE_TOOLCHAIN_FILE=[path_to_vcpkg]/scripts/buildsystems/vcpkg.cmake\n"
        "--------------------------\n"
    )
endif()

find_package(glfw3 CONFIG REQUIRED)
find_package(lunasvg CONFIG REQUIRED)
set_target_properties(lunasvg::lunasvg PROPERTIES
    IMPORTED_LOCATION_DEBUG   "${CMAKE_SOURCE_DIR}/vendor/minidfs_sdk/Debug/lib/lunasvg.lib"
    IMPORTED_LOCATION_RELEASE "${CMAKE_SOURCE_DIR}/vendor/minidfs_sdk/Release/lib/lunasvg.lib"
)
set_target_properties(plutovg::plutovg PROPERTIES
    IMPORTED_LOCATION_DEBUG   "${CMAKE_SOURCE_DIR}/vendor/minidfs_sdk/Debug/lib/plutovg.lib"
    IMPORTED_LOCATION_RELEASE "${CMAKE_SOURCE_DIR}/vendor/minidfs_sdk/Release/lib/plutovg.lib"
)


# Do the same for plutovg since lunasvg depends on it


message(STATUS "SDK fully loaded. No more compiler checks needed!")