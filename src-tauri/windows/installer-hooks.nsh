; Misty's NSIS hooks (bundle.windows.nsis.installerHooks).
;
; Misty registers itself as a browser and for launch on login from the app,
; under the person's own registry hive, so it always names the running copy.
; Uninstalling removes those entries; they would otherwise point at a missing
; program. The default-browser choice itself belongs to Windows, which falls
; back to another browser once Misty's registration is gone.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\MistyHTML"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Misty"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Misty"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Misty"
!macroend
