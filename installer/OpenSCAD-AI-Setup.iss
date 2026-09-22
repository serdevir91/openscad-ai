; =====================================================================
; OpenSCAD AI - Inno Setup 6 Installer Script
; Features:
; - Installs OpenSCAD AI native desktop app
; - Automatically detects existing OpenSCAD installation
; - Downloads and silently installs OpenSCAD 3D Engine if needed
; - Optional Codex CLI installation via npm
; - Multilingual support: Turkish and English
; =====================================================================

#define MyAppName "OpenSCAD AI"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "Serdevir"
#define MyAppURL "https://github.com/serdevir91/openscad-ai"
#define MyAppExeName "OpenSCAD AI.exe"

[Setup]
AppId={{D37E5528-6628-444A-949B-5A85A48DE12E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=..\LICENSE
OutputDir=..\dist-installer
OutputBaseFilename=OpenSCAD-AI-Setup-{#MyAppVersion}
SetupIconFile=..\src-tauri\icons\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
PrivilegesRequired=admin

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
turkish.TaskGroupShortcuts=Masaüstü ve Menü Kısayolları:
turkish.TaskGroupDependencies=Gerekli 3D Derleme Motoru:
turkish.TaskGroupTools=İsteğe Bağlı Yapay Zeka Araçları:
turkish.TaskOpenSCAD=OpenSCAD 3D Motorunu İndir ve Kur (Önerilen)
turkish.TaskCodex=Codex CLI Kur (OpenAI Terminal Kod Asistanı - Node.js gerekir)
turkish.InstallingOpenSCAD=OpenSCAD 3D derleme motoru kuruluyor, lütfen bekleyin...
turkish.InstallingCodex=Codex CLI kuruluyor (@openai/codex)...
turkish.CodexNoNpm=Codex CLI kurulumu için sisteminizde Node.js (npm) bulunamadı. Lütfen daha sonra nodejs.org adresinden Node.js kurup 'npm install -g @openai/codex' komutunu çalıştırın.
turkish.WebStudioLink=OpenSCAD AI Web Stüdyosu (Tarayıcı)
turkish.UninstallLink=OpenSCAD AI'yi Kaldır

english.TaskGroupShortcuts=Desktop and Menu Shortcuts:
english.TaskGroupDependencies=Required 3D Compilation Engine:
english.TaskGroupTools=Optional AI Developer Tools:
english.TaskOpenSCAD=Download and Install OpenSCAD 3D Engine (Recommended)
english.TaskCodex=Install Codex CLI (OpenAI Terminal Coding Assistant - Requires Node.js)
english.InstallingOpenSCAD=Installing OpenSCAD 3D engine, please wait...
english.InstallingCodex=Installing Codex CLI (@openai/codex)...
english.CodexNoNpm=Node.js (npm) was not found on your system. Please install Node.js from nodejs.org and run 'npm install -g @openai/codex'.
english.WebStudioLink=OpenSCAD AI Web Studio (Browser)
english.UninstallLink=Uninstall OpenSCAD AI

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:TaskGroupShortcuts}"
Name: "install_openscad"; Description: "{cm:TaskOpenSCAD}"; GroupDescription: "{cm:TaskGroupDependencies}"; Flags: unchecked
Name: "install_codex"; Description: "{cm:TaskCodex}"; GroupDescription: "{cm:TaskGroupTools}"; Flags: unchecked

[Files]
Source: "..\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\.openscad_docs_cache.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src-tauri\icons\icon.ico"; DestDir: "{app}"; DestName: "app_icon.ico"; Flags: ignoreversion
Source: "install-codex.bat"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall; Tasks: install_codex

[Icons]
Name: "{autoprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app_icon.ico"
Name: "{autoprograms}\{#MyAppName}\{cm:WebStudioLink}"; Filename: "https://serdevir91.github.io/openscad-ai/"
Name: "{autoprograms}\{#MyAppName}\GitHub Repository"; Filename: "{#MyAppURL}"
Name: "{autoprograms}\{#MyAppName}\{cm:UninstallLink}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app_icon.ico"; Tasks: desktopicon

[Run]
; Silently install OpenSCAD if downloaded
Filename: "{tmp}\OpenSCAD-Installer.exe"; Parameters: "/S"; Tasks: install_openscad; StatusMsg: "{cm:InstallingOpenSCAD}"; Flags: waituntilterminated
; Optionally install Codex CLI via helper batch in background
Filename: "{tmp}\install-codex.bat"; Tasks: install_codex; StatusMsg: "{cm:InstallingCodex}"; Flags: runhidden waituntilterminated
; Launch the application at finish
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
var
  DownloadPage: TDownloadWizardPage;

function IsOpenScadInstalled(): Boolean;
begin
  Result := FileExists(ExpandConstant('{commonpf}\OpenSCAD\openscad.exe')) or
            FileExists(ExpandConstant('{commonpf64}\OpenSCAD\openscad.exe')) or
            FileExists('C:\Program Files\OpenSCAD\openscad.exe') or
            FileExists('C:\Program Files (x86)\OpenSCAD\openscad.exe');
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  Result := True;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), @OnDownloadProgress);

  // If OpenSCAD is NOT already installed on this machine, select install_openscad by default
  if not IsOpenScadInstalled() then
  begin
    WizardSelectTasks('install_openscad');
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  HasDownloads: Boolean;
begin
  Result := True;
  if CurPageID = wpReady then
  begin
    DownloadPage.Clear;
    HasDownloads := False;

    if WizardIsTaskSelected('install_openscad') then
    begin
      DownloadPage.Add(
        'https://files.openscad.org/OpenSCAD-2021.01-x86-64-Installer.exe',
        'OpenSCAD-Installer.exe',
        ''
      );
      HasDownloads := True;
    end;

    if HasDownloads then
    begin
      DownloadPage.Show;
      try
        try
          DownloadPage.Download;
          Result := True;
        except
          if DownloadPage.AbortedByUser then
            Log('Download aborted by user.')
          else
            SuppressibleMsgBox(AddPeriod(GetExceptionMessage), mbCriticalError, MB_OK, IDOK);
          Result := False;
        end;
      finally
        DownloadPage.Hide;
      end;
    end;
  end;
end;
