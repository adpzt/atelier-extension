# Installe Kotak sur Windows, avec mises à jour automatiques depuis GitHub.
#   Dans PowerShell :  irm https://raw.githubusercontent.com/adpzt/kotak/main/scripts/install-windows.ps1 | iex
#
#  - l'extension (dossier à charger dans Chrome / Brave / Edge) : %USERPROFILE%\Extension Kotak
#  - le moteur Médias : yt-dlp + ffmpeg + Python portable dans %LOCALAPPDATA%\Kotak
#  - une tâche planifiée qui récupère les nouvelles versions toutes les 15 min
# Désinstallation : powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Kotak\uninstall.ps1"

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # téléchargements bien plus rapides sans barre de progression
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo    = 'adpzt/kotak'
$Ext     = Join-Path $env:USERPROFILE 'Extension Kotak'
$Base    = Join-Path $env:LOCALAPPDATA 'Kotak'
$Bin     = Join-Path $Base 'bin'
$PyDir   = Join-Path $Base 'python'
$ExtId   = 'pgimopnhknnafkfghffffkjckckedngg'   # identifiant fixe de l'extension (clé du manifeste)
$PyVer   = '3.12.7'

New-Item -ItemType Directory -Force -Path $Base, $Bin | Out-Null

function Get-Zip($url, $dest) {
  $tmp = Join-Path $env:TEMP ("kotak-" + [guid]::NewGuid() + ".zip")
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Expand-Archive -Path $tmp -DestinationPath $dest -Force
  Remove-Item -Force $tmp
}

# ---------- Extension ----------
Write-Host "→ Téléchargement de l'extension dans : $Ext"
$stage = Join-Path $env:TEMP 'kotak-release'
Get-Zip "https://github.com/$Repo/archive/refs/heads/release.zip" $stage
$inner = Get-ChildItem $stage | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $Ext | Out-Null
robocopy $inner.FullName $Ext /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
Remove-Item -Recurse -Force $stage

# ---------- Moteur Médias ----------
if (-not (Test-Path (Join-Path $Bin 'yt-dlp.exe'))) {
  Write-Host '→ Téléchargement de yt-dlp…'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $Bin 'yt-dlp.exe')
}
if (-not (Test-Path (Join-Path $Bin 'ffmpeg.exe'))) {
  Write-Host '→ Téléchargement de ffmpeg…'
  $ff = Join-Path $env:TEMP 'kotak-ffmpeg'
  Get-Zip 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' $ff
  Get-ChildItem $ff -Recurse -Include 'ffmpeg.exe', 'ffprobe.exe' | Copy-Item -Destination $Bin -Force
  Remove-Item -Recurse -Force $ff
}
if (-not (Test-Path (Join-Path $PyDir 'python.exe'))) {
  Write-Host '→ Téléchargement de Python (portable, réservé à Kotak)…'
  Get-Zip "https://www.python.org/ftp/python/$PyVer/python-$PyVer-embed-amd64.zip" $PyDir
}

# Lanceur du moteur (le script Python est livré avec l'extension et se met à jour avec elle).
$HostBat = Join-Path $Base 'kotak-engine.bat'
Set-Content -Path $HostBat -Encoding ASCII -Value "@echo off`r`n`"$PyDir\python.exe`" -u `"$Ext\host\kotak_host.py`" %*"

# Déclaration auprès des navigateurs (Native Messaging) : uniquement pour l'extension Kotak.
$ManifestPath = Join-Path $Base 'com.kotak.engine.json'
@{
  name            = 'com.kotak.engine'
  description     = 'Moteur local Kotak (yt-dlp + ffmpeg)'
  path            = $HostBat
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json | Set-Content -Path $ManifestPath -Encoding UTF8
foreach ($key in @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.kotak.engine',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.kotak.engine',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.kotak.engine',
    'HKCU:\Software\Chromium\NativeMessagingHosts\com.kotak.engine')) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(Default)' -Value $ManifestPath
}

# ---------- Mises à jour automatiques ----------
$Update = Join-Path $Base 'update.ps1'
@"
`$ErrorActionPreference = 'SilentlyContinue'
`$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
`$Ext = '$Ext'
`$Log = '$Base\update.log'
# Nouvelle version de Kotak ?
`$remote = (Invoke-RestMethod -UseBasicParsing 'https://raw.githubusercontent.com/$Repo/release/manifest.json').version
`$local = (Get-Content -Raw (Join-Path `$Ext 'manifest.json') | ConvertFrom-Json).version
if (`$remote -and `$remote -ne `$local) {
  `$tmp = Join-Path `$env:TEMP 'kotak-update'
  `$zip = "`$tmp.zip"
  Invoke-WebRequest -UseBasicParsing 'https://github.com/$Repo/archive/refs/heads/release.zip' -OutFile `$zip
  if (Test-Path `$tmp) { Remove-Item -Recurse -Force `$tmp }
  Expand-Archive `$zip `$tmp -Force
  `$inner = Get-ChildItem `$tmp | Select-Object -First 1
  robocopy `$inner.FullName `$Ext /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item -Recurse -Force `$tmp, `$zip
  Add-Content `$Log "`$(Get-Date -Format 'yyyy-MM-dd HH:mm') Kotak : `$local -> `$remote"
}
# yt-dlp suit les changements des sites : mise à jour une fois par jour.
`$stamp = '$Base\.ytdlp-check'
if (-not (Test-Path `$stamp) -or ((Get-Date) - (Get-Item `$stamp).LastWriteTime).TotalHours -gt 24) {
  & '$Bin\yt-dlp.exe' -U | Out-Null
  Set-Content `$stamp ''
}
"@ | Set-Content -Path $Update -Encoding UTF8

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Update`""
$repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$logon   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden
Register-ScheduledTask -TaskName 'Kotak - mise a jour' -Action $action -Trigger @($repeat, $logon) -Settings $settings -Force | Out-Null

# ---------- Désinstallation ----------
@"
Unregister-ScheduledTask -TaskName 'Kotak - mise a jour' -Confirm:`$false -ErrorAction SilentlyContinue
foreach (`$k in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.kotak.engine','HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.kotak.engine','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.kotak.engine','HKCU:\Software\Chromium\NativeMessagingHosts\com.kotak.engine')) { Remove-Item -Path `$k -Force -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force '$Ext', '$Base' -ErrorAction SilentlyContinue
Write-Host 'Kotak désinstallé. Retire aussi l''extension dans chrome://extensions (ou brave://extensions).'
"@ | Set-Content -Path (Join-Path $Base 'uninstall.ps1') -Encoding UTF8

$version = (Get-Content -Raw (Join-Path $Ext 'manifest.json') | ConvertFrom-Json).version
Set-Clipboard -Value $Ext
Write-Host ""
Write-Host "✅ Kotak v$version installé, mises à jour automatiques activées." -ForegroundColor Green
Write-Host ""
Write-Host "Dernière étape (une seule fois) dans Chrome, Brave ou Edge :"
Write-Host "  1. Ouvre chrome://extensions (ou brave://extensions) et active le « Mode développeur »"
Write-Host "  2. Clique « Charger l'extension non empaquetée »"
Write-Host "  3. Choisis ce dossier (le chemin est déjà dans ton presse-papier) :"
Write-Host "     $Ext"
Write-Host ""
Write-Host "Laisse le Mode développeur activé : c'est ce qui permet les mises à jour automatiques."
