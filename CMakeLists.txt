cmake_minimum_required(VERSION 3.16)
project(misty LANGUAGES CXX C OBJCXX VERSION 1.0)

include(CTest)
include(cmake/Options.cmake)
include(cmake/Dependencies.cmake)
include(cmake/MistyPlugins.cmake)

find_package(Doxygen QUIET)
if(DOXYGEN_FOUND)
    add_custom_target(docs
        COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_SOURCE_DIR}/docs/api"
        COMMAND ${DOXYGEN_EXECUTABLE} "${CMAKE_SOURCE_DIR}/Doxyfile"
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        COMMENT "Generating Misty API documentation"
        VERBATIM
    )
else()
    add_custom_target(docs
        COMMAND ${CMAKE_COMMAND} -E echo "Doxygen was not found. Install doxygen to generate docs."
        VERBATIM
    )
endif()

add_subdirectory(proto)
add_subdirectory(src)
add_subdirectory(tests)

if(MISTY_BUILD_BUNDLED_PLUGINS OR MISTY_BUILD_DEV_PLUGINS)
    set(MISTY_HOST_SOURCE_DIR "${CMAKE_SOURCE_DIR}" CACHE PATH "Path to the Misty host source tree")
    set(MISTY_PRIVATE_PLUGIN_DIR "$ENV{HOME}/.misty/plugins/private" CACHE PATH "Path to the user private plugin directory" FORCE)
    if(EXISTS "${MISTY_EXTERNAL_PLUGIN_DIR}/CMakeLists.txt")
        add_subdirectory("${MISTY_EXTERNAL_PLUGIN_DIR}" "${CMAKE_BINARY_DIR}/external_plugins")
        if(TARGET misty_plugin_sandbox)
            target_include_directories(misty_plugin_sandbox PRIVATE
                "${CMAKE_SOURCE_DIR}/vendor/watcher/include"
                "${CMAKE_SOURCE_DIR}/vendor/xxhash"
            )
            target_sources(misty_plugin_sandbox PRIVATE
                "${CMAKE_SOURCE_DIR}/src/panels/notification/notification_state.cpp"
            )
        endif()
    else()
        message(FATAL_ERROR "Plugin source directory not found: ${MISTY_EXTERNAL_PLUGIN_DIR}")
    endif()
endif()
