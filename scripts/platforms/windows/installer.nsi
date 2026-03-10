; OpenClaw Command Center — NSIS Installer Script
; Compiled on Linux: makensis installer.nsi

!include "MUI2.nsh"
!include "FileFunc.nsh"

; ── Config ──
!define PRODUCT_NAME "OpenClaw Command Center"
!define PRODUCT_PUBLISHER "OpenClaw"
!define PRODUCT_WEB_SITE "https://github.com/openclaw"
; VERSION is injected by build script: makensis -DVERSION=x.x.x
!ifndef VERSION
  !define VERSION "1.0.0"
!endif

; OUTDIR is injected by build script: makensis -DOUTDIR=/path/to/output
!ifndef OUTDIR
  !define OUTDIR "."
!endif

Name "${PRODUCT_NAME} ${VERSION}"
OutFile "${OUTDIR}\OpenClaw-Cmd-Setup-${VERSION}-win-x64.exe"
InstallDir "$PROGRAMFILES\OpenClaw Command Center"
InstallDirRegKey HKLM "Software\OpenClaw\CommandCenter" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; ── UI ──
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT_NAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install ${PRODUCT_NAME} ${VERSION} on your computer.$\r$\n$\r$\nThe application includes a bundled Node.js runtime — no additional software is required.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\launcher.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"

; ── Pages ──
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

; ── Install Section ──
Section "Install"
  SetOutPath "$INSTDIR"

  ; Copy all files from the staging directory
  File /r "${STAGE_DIR}\*.*"

  ; Registry
  WriteRegStr HKLM "Software\OpenClaw\CommandCenter" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\OpenClaw\CommandCenter" "Version" "${VERSION}"

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Add/Remove Programs entry
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "DisplayVersion" "${VERSION}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "NoRepair" 1

  ; Get install size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd" \
    "EstimatedSize" $0

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\launcher.bat" \
    "" "$INSTDIR\launcher.bat" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\launcher.bat" \
    "" "$INSTDIR\launcher.bat" 0

SectionEnd

; ── Uninstall Section ──
Section "Uninstall"

  ; Kill running process
  nsExec::ExecToLog 'taskkill /IM node.exe /F'

  ; Remove files
  RMDir /r "$INSTDIR"

  ; Remove shortcuts
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove registry
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawCmd"
  DeleteRegKey HKLM "Software\OpenClaw\CommandCenter"

SectionEnd
