set(MISTY_PLUGIN_SDK_VERSION "${PROJECT_VERSION}")
set(MISTY_PLUGIN_BUILD_ID_DEFAULT "${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}-${CMAKE_CXX_COMPILER_ID}-${CMAKE_CXX_COMPILER_VERSION}-sdk${MISTY_PLUGIN_SDK_VERSION}")
set(MISTY_PLUGIN_BUILD_ID "${MISTY_PLUGIN_BUILD_ID_DEFAULT}" CACHE STRING "Plugin build id accepted by this Misty build")
set(MISTY_REQUIRE_SIGNED_PLUGINS OFF CACHE BOOL "Reject unsigned plugins before load")
set(MISTY_PLUGIN_USER_TRUST_DIR "")
set(MISTY_REQUIRE_SIGNED_PLUGINS_VALUE 0)

if(MISTY_REQUIRE_SIGNED_PLUGINS)
    set(MISTY_REQUIRE_SIGNED_PLUGINS_VALUE 1)
endif()

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

set(MISTY_BUILD_BUNDLED_PLUGINS OFF CACHE BOOL "Build first-party plugins bundled with the client")
set(MISTY_BUILD_DEV_PLUGINS ON CACHE BOOL "Build first-party development plugins for local preview and sandbox workflows")

function(misty_configure_plugin_host target)
    target_compile_definitions(${target}
        PRIVATE
            MISTY_PLUGIN_SDK_VERSION="${MISTY_PLUGIN_SDK_VERSION}"
            MISTY_PLUGIN_BUILD_ID="${MISTY_PLUGIN_BUILD_ID}"
            MISTY_PLUGIN_USER_TRUST_DIR="${MISTY_PLUGIN_USER_TRUST_DIR}"
            MISTY_REQUIRE_SIGNED_PLUGINS=${MISTY_REQUIRE_SIGNED_PLUGINS_VALUE}
    )
endfunction()
