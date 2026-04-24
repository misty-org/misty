set(MISTY_PLUGIN_SDK_VERSION "${PROJECT_VERSION}")
set(MISTY_PLUGIN_BUILD_ID_DEFAULT "${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}-${CMAKE_CXX_COMPILER_ID}-${CMAKE_CXX_COMPILER_VERSION}-sdk${MISTY_PLUGIN_SDK_VERSION}")
set(MISTY_PLUGIN_BUILD_ID "${MISTY_PLUGIN_BUILD_ID_DEFAULT}" CACHE STRING "Plugin build id accepted by this Misty build")
set(MISTY_PLUGIN_TRUST_PUBKEY "" CACHE FILEPATH "Optional PEM public key for trusted plugin signatures")
set(MISTY_REQUIRE_SIGNED_PLUGINS OFF CACHE BOOL "Reject unsigned plugins before load")
set(MISTY_PLUGIN_TRUST_DIR "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/plugin_keys")
set(MISTY_PLUGIN_USER_TRUST_DIR "")
set(MISTY_PLUGIN_TRUST_PUBKEY_PEM "")
set(MISTY_REQUIRE_SIGNED_PLUGINS_VALUE 0)

if(MISTY_REQUIRE_SIGNED_PLUGINS)
    set(MISTY_REQUIRE_SIGNED_PLUGINS_VALUE 1)
endif()

if(MISTY_PLUGIN_TRUST_PUBKEY AND EXISTS "${MISTY_PLUGIN_TRUST_PUBKEY}")
    file(READ "${MISTY_PLUGIN_TRUST_PUBKEY}" MISTY_PLUGIN_TRUST_PUBKEY_PEM)
endif()

file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/generated")
configure_file(
    "${CMAKE_SOURCE_DIR}/cmake/plugin_build_config.h.in"
    "${CMAKE_BINARY_DIR}/generated/plugin_build_config.h"
    @ONLY
)

if(WIN32)
    set(MISTY_HOST_OS "windows")
elseif(APPLE)
    set(MISTY_HOST_OS "macos")
else()
    set(MISTY_HOST_OS "linux")
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "(aarch64|arm64|ARM64)")
    set(MISTY_HOST_ARCH "arm64")
else()
    set(MISTY_HOST_ARCH "x86_64")
endif()

set(MISTY_PLUGIN_VARIANT_DIR "variants/${MISTY_HOST_OS}-${MISTY_HOST_ARCH}")
set(MISTY_PLUGIN_OUTPUT_DIR "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/plugins/preview_manager")
set(MISTY_PLUGIN_VARIANT_OUTPUT_DIR "${MISTY_PLUGIN_OUTPUT_DIR}/${MISTY_PLUGIN_VARIANT_DIR}")
set(MISTY_PREVIEW_MANAGER_LIBRARY_NAME "preview_manager${CMAKE_SHARED_LIBRARY_SUFFIX}")
set(MISTY_PREVIEW_MANAGER_VARIANT_LIBRARY "${MISTY_PLUGIN_VARIANT_DIR}/${MISTY_PREVIEW_MANAGER_LIBRARY_NAME}")

configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/manifest.json.in"
    "${CMAKE_CURRENT_BINARY_DIR}/preview_manager/manifest.json"
    @ONLY
)

add_library(preview_manager MODULE
    "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/plugin.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/stb_impl.cpp"
)
set_target_properties(preview_manager PROPERTIES
    PREFIX ""
    OUTPUT_NAME "preview_manager"
    SUFFIX "${CMAKE_SHARED_LIBRARY_SUFFIX}"
    LIBRARY_OUTPUT_DIRECTORY "${MISTY_PLUGIN_VARIANT_OUTPUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY "${MISTY_PLUGIN_VARIANT_OUTPUT_DIR}"
)
target_include_directories(preview_manager
    PRIVATE
        "${CMAKE_SOURCE_DIR}/src"
        "${CMAKE_SOURCE_DIR}/vendor/stb"
)
target_compile_definitions(preview_manager PRIVATE MISTY_PLUGIN_BUILD=1)

add_custom_target(preview_manager_manifest ALL
    COMMAND ${CMAKE_COMMAND} -E make_directory "${MISTY_PLUGIN_OUTPUT_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_BINARY_DIR}/preview_manager/manifest.json"
        "${MISTY_PLUGIN_OUTPUT_DIR}/manifest.json"
    DEPENDS preview_manager
)
