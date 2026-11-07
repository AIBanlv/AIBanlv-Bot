Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
; Compile-time identifiers let safety fixtures use their own registry/shortcuts.
!ifndef INSTALL_ID
!define INSTALL_ID "ControlDeviceTest"
!endif
!ifndef SHORTCUT_NAME
!define SHORTCUT_NAME "AIBanlv"
!endif
!ifndef LEGACY_SHORTCUT_NAME
!define LEGACY_SHORTCUT_NAME "Control Device"
!endif
Name "AIBanlv"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\AIBanlv"
InstallDirRegKey HKCU "Software\${INSTALL_ID}" "InstallDir"
RequestExecutionLevel user
; Per-file compression preserves unchanged file streams for blockmap reuse.
SetCompressor zlib
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "AIBanlv"
VIAddVersionKey "CompanyName" "Ieasysell Limited"
VIAddVersionKey "FileDescription" "AIBanlv Desktop Companion Internal Test Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AIBanlv"
Icon "${ICON}"
UninstallIcon "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\AIBanlv.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open AIBanlv"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Var LockedFile
Var LockError
Var InstallCheckAttempts
LangString InstallBlockedHint ${LANG_SIMPCHINESE} "暂时无法更新 AIBanlv，尚未覆盖现有文件。$\r$\n$\r$\n请从系统托盘右键选择退出 AIBanlv，再点击重试。只关闭窗口不会退出程序。若仍然失败，请确认安装目录有写入权限。$\r$\n$\r$\n文件：$LockedFile$\r$\nWindows 错误码：$LockError"
LangString InstallBlockedHint ${LANG_ENGLISH} "AIBanlv cannot be updated yet. Existing files have not been replaced.$\r$\n$\r$\nExit AIBanlv from the system tray, then click Retry. Closing its window does not exit the app. If this still fails, check write permissions for the installation folder.$\r$\n$\r$\nFile: $LockedFile$\r$\nWindows error: $LockError"

Function .onInit
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_OK|MB_ICONSTOP "This test build requires Windows x64."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Windows 10 or later is required."
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Function ValidateInstallDir
  IfFileExists "$INSTDIR\.control-device-install" marker 0
  FindFirst $0 $1 "$INSTDIR\*"
  loop:
    StrCmp $1 "" empty
    StrCmp $1 "." next
    StrCmp $1 ".." next
    FindClose $0
    SetErrors
    Return
  next:
    FindNext $0 $1
    Goto loop
  empty:
    FindClose $0
    Goto valid
  marker:
    FileOpen $0 "$INSTDIR\.control-device-install" r
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "Control Device$\r$\n" valid
    SetErrors
    Return
  valid:
    ClearErrors
FunctionEnd

Function .onVerifyInstDir
  Call ValidateInstallDir
  IfErrors 0 +2
    Abort
FunctionEnd

; The input path is consumed and all scratch registers are restored. OPEN_EXISTING
; never creates or truncates a file. No process-name matching, killing or ACL edits.
Function CheckInstallFileWritable
  Exch $0
  Push $1
  Push $2
  StrCpy $1 -1
  System::Call 'kernel32::CreateFileW(w r0, i 0x40000000, i 0, p 0, i 3, i 0x80, p 0) p.r1 ?e'
  Pop $2
  IntCmp $1 -1 failed
  System::Call 'kernel32::CloseHandle(p r1)'
  Goto done
  failed:
    ; Missing payload files are normal on a fresh install or version upgrade.
    StrCmp $2 2 done
    StrCmp $2 3 done
    StrCpy $LockedFile $0
    StrCpy $LockError $2
  done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function CheckInstallFiles
  StrCpy $LockedFile ""
  StrCpy $LockError 0
  !include "${PREFLIGHT_FILES}"
FunctionEnd

Function EnsureInstallWritable
  retry:
    StrCpy $InstallCheckAttempts 0
  check:
    Call CheckInstallFiles
    StrCmp $LockedFile "" ready
    ; Silent upgrades fail closed, without an invisible dialog or endless wait.
    IfSilent blocked
    ; Give workers/antivirus a short bounded grace period to release their files.
    IntOp $InstallCheckAttempts $InstallCheckAttempts + 1
    IntCmp $InstallCheckAttempts 10 prompt wait prompt
  wait:
    Sleep 250
    Goto check
  prompt:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(InstallBlockedHint)" /SD IDCANCEL IDRETRY retry
  blocked:
    DetailPrint "$(InstallBlockedHint)"
    SetErrorLevel 2
    Abort
  ready:
    ClearErrors
FunctionEnd

Section "AIBanlv"
  Call ValidateInstallDir
  IfErrors 0 valid
    MessageBox MB_OK|MB_ICONSTOP "Choose an empty folder, or the existing AIBanlv installation." /SD IDOK
    SetErrorLevel 1
    Abort
  valid:
  Call EnsureInstallWritable
  ; Keep the existing ownership marker/registry so old bindings and upgrades
  ; retain their identity. Remove only the legacy owned executable/shortcuts.
  IfFileExists "$INSTDIR\.control-device-install" 0 renamed
  IfFileExists "$INSTDIR\ControlDevice.exe" 0 legacy_links
  ClearErrors
  Delete "$INSTDIR\ControlDevice.exe"
  IfErrors 0 legacy_links
    MessageBox MB_OK|MB_ICONSTOP "Close Control Device before upgrading to AIBanlv." /SD IDOK
    SetErrorLevel 1
    Abort
  legacy_links:
  Delete "$DESKTOP\${LEGACY_SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${LEGACY_SHORTCUT_NAME}\${LEGACY_SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${LEGACY_SHORTCUT_NAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${LEGACY_SHORTCUT_NAME}"
  renamed:
  SetOutPath "$INSTDIR"
  ; A new lock after preflight must not allow an incomplete 'Ignore' installation.
  AllowSkipFiles off
  File /r "${APPDIR}\*"
  FileOpen $0 "$INSTDIR\.control-device-install" w
  FileWrite $0 "Control Device$\r$\n"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${SHORTCUT_NAME}"
  CreateShortcut "$SMPROGRAMS\${SHORTCUT_NAME}\${SHORTCUT_NAME}.lnk" "$INSTDIR\AIBanlv.exe" "" "$INSTDIR\AIBanlv.exe" 0
  CreateShortcut "$SMPROGRAMS\${SHORTCUT_NAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\AIBanlv.exe" "" "$INSTDIR\AIBanlv.exe" 0
  ; Autostart shares the installation identifier, including isolated fixtures.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${INSTALL_ID}" '$\"$INSTDIR\AIBanlv.exe$\"'
  WriteRegStr HKCU "Software\${INSTALL_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "DisplayName" "AIBanlv (Internal Test)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "Publisher" "Ieasysell Limited"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "DisplayIcon" "$INSTDIR\AIBanlv.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "EstimatedSize" ${SIZE}
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}" "NoRepair" 1
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  FileOpen $0 "$INSTDIR\.control-device-install" r
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "Control Device$\r$\n" valid
  MessageBox MB_OK|MB_ICONSTOP "AIBanlv installation marker was not found." /SD IDOK
  Abort
  valid:
FunctionEnd

Section "Uninstall"
  StrCpy $R9 0
  !include "${UNINSTALL_FILES}"
  StrCmp $R9 0 complete
    MessageBox MB_OK|MB_ICONSTOP "Some files are in use. Close AIBanlv and retry uninstall." /SD IDOK
    SetErrorLevel 1
    Abort
  complete:
  Delete "$INSTDIR\.control-device-install"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${SHORTCUT_NAME}"
  DeleteRegKey HKCU "Software\${INSTALL_ID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${INSTALL_ID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_ID}"
SectionEnd
