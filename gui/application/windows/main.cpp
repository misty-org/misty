#include <windows.h>

#include "windows_app.h"
#include "layout.h"


int APIENTRY WinMain(_In_ HINSTANCE hInstance, _In_opt_ HINSTANCE hPrevInstance, _In_ LPSTR lpCmdLine, _In_ int nShowCmd) {
	nShowCmd = 1;

	WindowsApp app;

	if (app.init() != 0) {
		MessageBoxA(NULL, "Application failed to initialize! Check the logs or debugger.", "Critical Error", MB_OK | MB_ICONERROR);
		return -1;
	}

	while (app.is_running()) {
		app.prepare_frame();
		
		show_master_dockspace();
		show_demo_window();
		show_file_explorer();
				
		app.render_frame();

	}
}