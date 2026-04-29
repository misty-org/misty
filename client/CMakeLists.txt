cmake_minimum_required(VERSION 3.16)
project(misty LANGUAGES CXX C OBJCXX VERSION 1.0)

include(CTest)
include(cmake/Options.cmake)
include(cmake/Dependencies.cmake)
include(cmake/MistyPlugins.cmake)

add_subdirectory(proto)
add_subdirectory(src)
add_subdirectory(tests)

if(MISTY_BUILD_BUNDLED_PLUGINS)
    add_subdirectory(plugins)
endif()
