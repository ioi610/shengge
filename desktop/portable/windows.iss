[Setup]
AppId=Shengge.Desktop
AppName=声格
AppVersion=0.3.6
DefaultDirName={localappdata}\Programs\Shengge
DefaultGroupName=声格
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\release
OutputBaseFilename=Shengge-Windows-x64-Setup
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=yes

[Files]
Source: "..\..\dist\portable-win64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\声格"; Filename: "{app}\Shengge.exe"
Name: "{userdesktop}\声格"; Filename: "{app}\Shengge.exe"
[Run]
Filename: "{app}\Shengge.exe"; Description: "打开声格"; Flags: nowait postinstall skipifsilent
