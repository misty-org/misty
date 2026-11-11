; Misty's NSIS hooks (bundle.windows.nsis.installerHooks).
;
; Misty registers for launch on login from the app, under the person's own
; registry hive, so it always names the running copy. Earlier versions also
; registered Misty as a browser there. Uninstalling removes those entries;
; they would otherwise point at a missing program.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\MistyHTML"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Misty"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Misty"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Misty"
!macroend
