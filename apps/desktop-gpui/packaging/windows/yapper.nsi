Unicode true
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Yapper"
InstallDirRegKey HKCU "Software\Yapper" "InstallLocation"

!include "MUI2.nsh"
!include "x64.nsh"

!ifndef YAPPER_BINARY
  !error "Pass /DYAPPER_BINARY with the path to the Windows x64 release executable"
!endif
!ifndef YAPPER_VERSION
  !error "Pass /DYAPPER_VERSION with the Cargo package version"
!endif
!ifndef YAPPER_INSTALLER
  !define YAPPER_INSTALLER "Yapper-${YAPPER_VERSION}-windows-x64-setup.exe"
!endif

Name "Yapper"
OutFile "${YAPPER_INSTALLER}"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Polish"

LangString WrongArchitecture ${LANG_ENGLISH} "Yapper requires 64-bit Windows."
LangString WrongArchitecture ${LANG_POLISH} "Yapper wymaga 64-bitowego systemu Windows."
LangString CopyFailed ${LANG_ENGLISH} "Close Yapper before installing or updating it."
LangString CopyFailed ${LANG_POLISH} "Zamknij Yappera przed instalacją lub aktualizacją."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "$(WrongArchitecture)"
    Abort
  ${EndIf}
  SetShellVarContext current
FunctionEnd

Section "Yapper"
  SetOutPath "$INSTDIR"
  ClearErrors
  File /oname=Yapper.exe "${YAPPER_BINARY}"
  IfErrors copy_failed
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Yapper"
  CreateShortcut "$SMPROGRAMS\Yapper\Yapper.lnk" "$INSTDIR\Yapper.exe"
  WriteRegStr HKCU "Software\Yapper" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "DisplayName" "Yapper"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "DisplayVersion" "${YAPPER_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "DisplayIcon" "$INSTDIR\Yapper.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper" "NoRepair" 1
  Goto done
copy_failed:
  MessageBox MB_ICONSTOP "$(CopyFailed)"
  SetErrorLevel 1
  Abort
done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ClearErrors
  Delete "$INSTDIR\Yapper.exe"
  IfErrors uninstall_failed
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Yapper\Yapper.lnk"
  RMDir "$SMPROGRAMS\Yapper"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yapper"
  DeleteRegValue HKCU "Software\Yapper" "InstallLocation"
  Goto done
uninstall_failed:
  MessageBox MB_ICONSTOP "$(CopyFailed)"
  SetErrorLevel 1
  Abort
done:
SectionEnd
