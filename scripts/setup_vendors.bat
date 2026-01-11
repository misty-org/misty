@echo off
setlocal enabledelayedexpansion

:: 1. Setup Usage / Help Check
set "ARG1=%~1"
if "%ARG1%"=="/?" goto :usage
if "%ARG1%"=="--help" goto :usage

:: 2. Setup Paths
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."
set "ROOT_DIR=%cd%"

:: 3. Get Configuration from first parameter (Default to Release)
set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

:: Validation: Check against valid CMake Build Configurations
if /i NOT "%CONFIG%"=="Release" if /i NOT "%CONFIG%"=="Debug" if /i NOT "%CONFIG%"=="RelWithDebInfo" (
    echo [ERROR] Invalid configuration: %CONFIG%
    goto :usage
)

:: The path now clearly reflects it is based on the Build Configuration
set "MINIDFS_DIR=%ROOT_DIR%\vendor\minidfs_sdk\%CONFIG%"
set "GLFW_SRC=%ROOT_DIR%\vendor\glfw"
set "LUNA_SRC=%ROOT_DIR%\vendor\lunasvg"
set "GOOGLE_TEST_SRC=%ROOT_DIR%\vendor\googletest"

echo ========================================================
echo Pre-compiling Vendors into %MINIDFS_DIR%
echo Configuration: %CONFIG%
echo ========================================================

if not exist "%MINIDFS_DIR%" mkdir "%MINIDFS_DIR%"

:: --- 3. Build GLFW ---
echo Building GLFW [%CONFIG%]...
cmake -B "%GLFW_SRC%\build_%CONFIG%" -S "%GLFW_SRC%" ^
    -DCMAKE_INSTALL_PREFIX="%MINIDFS_DIR%" ^
    -DGLFW_BUILD_DOCS=OFF -DGLFW_INSTALL=ON
cmake --build "%GLFW_SRC%\build_%CONFIG%" --config %CONFIG% --target install

:: --- 4. Build LunaSVG ---
echo Building LunaSVG [%CONFIG%]...
cmake -B "%LUNA_SRC%\build_%CONFIG%" -S "%LUNA_SRC%" ^
    -DCMAKE_INSTALL_PREFIX="%MINIDFS_DIR%" ^
    -DLUNASVG_BUILD_SHARED=OFF
cmake --build "%LUNA_SRC%\build_%CONFIG%" --config %CONFIG% --target install

:: --- 5. Build Google Test ---
echo Building Google Test [%CONFIG%]...
cmake -B "%GOOGLE_TEST_SRC%\build_%CONFIG%" -S "%GOOGLE_TEST_SRC%" ^
    -DCMAKE_INSTALL_PREFIX="%MINIDFS_DIR%" ^
    -Dgtest_force_shared_crt=ON -Dgtest_build_tests=OFF
cmake --build "%GOOGLE_TEST_SRC%\build_%CONFIG%" --config %CONFIG% --target install -j %NUMBER_OF_PROCESSORS%

echo ========================================================
echo SUCCESS!
echo Configuration : %CONFIG%
echo Location      : "%MINIDFS_DIR%"
echo ==============================================================================================================
pause
exit /b 0

:usage
echo ========================================================
echo MiniDFS Vendor Build Script Usage
echo ========================================================
echo Syntax:
echo   build_vendors.bat [Configuration]
echo.
echo Configurations:
echo   Release        - Optimized build (Default)
echo   Debug          - Build with debug symbols and CRT checks
echo   RelWithDebInfo - Optimized build with symbols
echo ========================================================
pause
exit /b 1