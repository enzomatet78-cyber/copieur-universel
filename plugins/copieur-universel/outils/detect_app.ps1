<#
.SYNOPSIS
  detect_app.ps1 - reconnaissance d'une appli de bureau installée (plugin copieur-universel).

.DESCRIPTION
  Dit avec quoi une appli est construite (Electron, NW.js, CEF, WebView2, Tauri, .NET WPF/WinForms,
  WinUI 3, UWP/MSIX, Avalonia, MAUI, Qt, Java, Flutter, Delphi, wxWidgets, GTK, Tkinter, MFC, Win32 natif,
  moteurs de jeu, navigateur Chromium) et comment la capturer ensuite (skill capture-bureau).

  LECTURE SEULE. Le script lit des noms de fichiers, l'en-tête PE et les informations de version des .exe,
  les manifestes (AppxManifest.xml, package.json, product.json, *.runtimeconfig.json, *.deps.json), l'en-tête
  d'une archive app.asar, et cherche quelques chaînes dans l'exécutable principal (version d'Electron,
  fusibles Electron, références d'interface .NET). Il ne lance, ne modifie, ne décompile rien et ne lit pas
  le contenu des dossiers de données (il signale seulement s'ils existent).
  Avec -ProcessName / -ProcessId (ou si l'exe analysé tourne déjà), il lit aussi la liste des modules chargés
  et des processus enfants (sans toucher au processus).

  Sortie : JSON (UTF-8) sur la console, et dans -Out si indiqué. Code retour 0 = analyse faite, 1 = erreur.
  Windows PowerShell 5.1 ou PowerShell 7. Sous macOS/Linux (pwsh) : détection par fichiers seulement (non testée).

.PARAMETER Path
  Dossier d'installation, .exe ou raccourci .lnk (ex. "C:\Program Files\Microsoft VS Code"). Un nom de
  commande (ex. code) est aussi accepté. Si le chemin n'existe pas, le script essaie le même nom sous
  %LOCALAPPDATA%\Programs, Program Files, Program Files (x86), %LOCALAPPDATA% et %APPDATA% (avertissement).
.PARAMETER ProcessName
  Nom d'un processus en cours (ex. notepad, Code). Le processus principal est choisi automatiquement.
.PARAMETER ProcessId
  PID d'un processus en cours.
.PARAMETER Out
  Fichier JSON de sortie (UTF-8 sans BOM).
.PARAMETER NoBinaryScan
  Ne pas parcourir l'exécutable (plus rapide ; ni version d'Electron lue dans l'exe, ni fusibles).
.PARAMETER MaxScanMB
  Taille maximale d'exécutable parcouru (défaut 600 Mo).
.PARAMETER Compress
  JSON sur une seule ligne.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File detect_app.ps1 -Path "$env:LOCALAPPDATA\Programs\Microsoft VS Code"
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File detect_app.ps1 -ProcessName notepad -Out "$env:TEMP\notepad.json"
#>
#Requires -Version 5.1
# Pas de jeux de paramètres PowerShell : leurs erreurs (« le jeu de paramètres ne peut pas être résolu »,
# PID non numérique) s'afficheraient en texte rouge au lieu du JSON { ok:false, erreur, pistes } promis.
# La cohérence des arguments est donc vérifiée plus bas, par le script lui-même.
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Path,
  [string]$ProcessName,
  [string]$ProcessId,
  [string]$Out,
  [switch]$NoBinaryScan,
  [int]$MaxScanMB = 600,
  [switch]$Compress
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$script:onWindows = ($env:OS -eq 'Windows_NT')
$script:warnings = New-Object System.Collections.Generic.List[string]
$script:hints = New-Object System.Collections.Generic.List[string]
$script:notes = New-Object System.Collections.Generic.List[string]
$script:scores = @{}
$script:outils = $PSScriptRoot
if (-not $script:outils) { $script:outils = Split-Path -Parent $MyInvocation.MyCommand.Path }
$script:started = [Diagnostics.Stopwatch]::StartNew()
$script:wideRoot = $false

# Ordre de priorité en cas d'égalité de score (le plus spécifique d'abord)
$script:prio = @('electron', 'nwjs', 'cef', 'tauri', 'flutter', 'unity', 'unreal', 'godot', 'avalonia', 'maui',
  'winui3', 'wpf', 'winforms', 'uwp', 'qt', 'java', 'delphi', 'wx', 'gtk', 'tkinter', 'webview2',
  'chromium-browser', 'gecko', 'mfc', 'dotnet', 'python', 'win32')

$script:labels = @{
  'electron'         = 'Electron (Chromium + Node.js) : interface web'
  'nwjs'             = 'NW.js (Chromium + Node.js) : interface web'
  'cef'              = 'CEF (Chromium Embedded Framework) : interface web dans une appli native'
  'tauri'            = 'Tauri (Rust + WebView2) : interface web'
  'webview2'         = 'WebView2 (Edge/Chromium intégré) : interface web dans une appli native'
  'chromium-browser' = 'Navigateur Chromium (Chrome, Edge, Brave...) : un navigateur, pas une appli à copier en soi'
  'gecko'            = 'Gecko (moteur de Firefox / Thunderbird) : interface XUL/HTML'
  'flutter'          = 'Flutter (Dart) : interface dessinée par le moteur, pas de contrôles natifs'
  'unity'            = 'Moteur de jeu Unity : rendu GPU'
  'unreal'           = 'Moteur de jeu Unreal : rendu GPU'
  'godot'            = 'Moteur de jeu Godot : rendu GPU'
  'avalonia'         = 'Avalonia UI (.NET multiplateforme, XAML)'
  'maui'             = '.NET MAUI (WinUI 3 sous Windows)'
  'winui3'           = 'WinUI 3 / Windows App SDK (XAML natif)'
  'wpf'              = '.NET WPF (XAML)'
  'winforms'         = '.NET WinForms'
  'uwp'              = 'UWP (XAML Windows, appli du Store)'
  'qt'               = 'Qt (C++/QML, ou PyQt/PySide)'
  'java'             = 'Java (Swing, JavaFX ou SWT)'
  'delphi'           = 'Delphi / C++Builder (VCL ou FMX)'
  'wx'               = 'wxWidgets'
  'gtk'              = 'GTK'
  'tkinter'          = 'Python Tkinter'
  'python'           = 'Python (bibliothèque d''interface non déterminée)'
  'mfc'              = 'Win32 C++ avec MFC'
  'dotnet'           = '.NET (bibliothèque d''interface non déterminée)'
  'win32'            = 'Win32 natif (C/C++, contrôles Windows standard)'
  'inconnu'          = 'Indéterminé'
}

function Add-Hint {
  param([string]$Fw, [double]$W, [string]$Text)
  if (-not $script:scores.ContainsKey($Fw)) { $script:scores[$Fw] = 0.0 }
  $script:scores[$Fw] += $W
  if ($Text) { $script:hints.Add(('{0} +{1} : {2}' -f $Fw, $W, $Text)) }
}

function Get-Score([string]$Fw) {
  if ($script:scores.ContainsKey($Fw)) { return [double]$script:scores[$Fw] }
  return 0.0
}

# ConvertTo-Json de PowerShell 5.1 indente très largement et échappe ' < > & en \u00XX : on réindente
# à 2 espaces et on rétablit ces caractères (sans danger dans une chaîne JSON).
function Format-Json {
  param([string]$Json, [switch]$OneLine)
  $Json = [regex]::Replace($Json, '(?<!\\)((?:\\\\)*)\\u00(27|3c|3e|26)', { param($m) $m.Groups[1].Value + [char][Convert]::ToInt32($m.Groups[2].Value, 16) })
  if ($OneLine) { return $Json }
  $sb = New-Object System.Text.StringBuilder ($Json.Length * 2)
  $ind = 0; $inStr = $false; $esc = $false; $n = $Json.Length
  for ($i = 0; $i -lt $n; $i++) {
    $c = $Json[$i]
    if ($inStr) {
      [void]$sb.Append($c)
      if ($esc) { $esc = $false } elseif ($c -eq [char]'\') { $esc = $true } elseif ($c -eq [char]'"') { $inStr = $false }
    } elseif ($c -eq [char]'"') { $inStr = $true; [void]$sb.Append($c) }
    elseif ($c -eq [char]'{' -or $c -eq [char]'[') {
      $close = [char]']'; if ($c -eq [char]'{') { $close = [char]'}' }
      if ($i + 1 -lt $n -and $Json[$i + 1] -eq $close) { [void]$sb.Append($c).Append($close); $i++ }
      else { $ind++; [void]$sb.Append($c).Append("`n").Append(' ' * (2 * $ind)) }
    }
    elseif ($c -eq [char]'}' -or $c -eq [char]']') { $ind--; [void]$sb.Append("`n").Append(' ' * (2 * $ind)).Append($c) }
    elseif ($c -eq [char]',') { [void]$sb.Append(",`n").Append(' ' * (2 * $ind)) }
    elseif ($c -eq [char]':') { [void]$sb.Append(': ') }
    elseif ([char]::IsWhiteSpace($c)) { }
    else { [void]$sb.Append($c) }
  }
  return $sb.ToString()
}

function Out-Result {
  param($Obj, [int]$Code = 0)
  $json = Format-Json -Json ($Obj | ConvertTo-Json -Depth 12 -Compress) -OneLine:$Compress
  if ($Out) {
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
    $dir = Split-Path -Parent $full
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, $json, (New-Object System.Text.UTF8Encoding($false)))
  }
  Write-Output $json
  exit $Code
}

function Fail {
  param([string]$Msg, [string[]]$Tips = @())
  Out-Result ([ordered]@{ ok = $false; erreur = $Msg; pistes = @($Tips); avertissements = @($script:warnings) }) 1
}

function Q([string]$s) { return "'" + ($s -replace "'", "''") + "'" }   # chaîne PowerShell entre apostrophes

# ---------------------------------------------------------------------------------------------------------
# Lecture de fichiers
# ---------------------------------------------------------------------------------------------------------
function Read-TextSafe {
  param([string]$File, [int]$MaxBytes = 4MB)
  try {
    $fi = Get-Item -LiteralPath $File -Force
    if ($fi.Length -gt $MaxBytes) { return $null }
    return [IO.File]::ReadAllText($fi.FullName, [Text.Encoding]::UTF8)
  } catch { return $null }
}

function ConvertFrom-JsonSafe {
  param([string]$Text)
  if (-not $Text) { return $null }
  $Text = $Text.TrimStart([char]0xFEFF)
  try { return ($Text | ConvertFrom-Json) } catch { }
  # Windows PowerShell 5.1 : ConvertFrom-Json refuse les textes > 2 Mo -> JavaScriptSerializer sans limite
  try {
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    $ser.RecursionLimit = 4096
    return $ser.DeserializeObject($Text)
  } catch { return $null }
}

function Get-Prop {
  param($Obj, [string]$Name)
  if ($null -eq $Obj) { return $null }
  if ($Obj -is [System.Collections.IDictionary]) { if ($Obj.Contains($Name)) { return $Obj[$Name] } else { return $null } }
  $p = $Obj.PSObject.Properties[$Name]
  if ($p) { return $p.Value }
  return $null
}

function Get-Keys {
  param($Obj)
  if ($null -eq $Obj) { return @() }
  if ($Obj -is [System.Collections.IDictionary]) { return @($Obj.Keys) }
  return @($Obj.PSObject.Properties | ForEach-Object { $_.Name })
}

function Get-PeInfo {
  param([string]$File)
  $info = [ordered]@{ architecture = $null; interfaceGraphique = $null; assemblyDotnet = $false }
  try {
    $fs = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $b = New-Object byte[] 4096
      $n = $fs.Read($b, 0, 4096)
      if ($n -lt 64 -or $b[0] -ne 0x4D -or $b[1] -ne 0x5A) { return $null }
      $pe = [BitConverter]::ToInt32($b, 0x3C)
      if ($pe -le 0 -or ($pe + 24 + 240) -gt $n) { return $info }
      if ([BitConverter]::ToUInt32($b, $pe) -ne 0x00004550) { return $null }
      $machine = [BitConverter]::ToUInt16($b, $pe + 4)
      switch ($machine) {
        0x8664 { $info.architecture = 'x64' }
        0x14c { $info.architecture = 'x86' }
        0xAA64 { $info.architecture = 'arm64' }
        default { $info.architecture = ('0x{0:X}' -f $machine) }
      }
      $opt = $pe + 24
      $magic = [BitConverter]::ToUInt16($b, $opt)
      $sub = [BitConverter]::ToUInt16($b, $opt + 68)
      $info.interfaceGraphique = ($sub -eq 2)
      if ($magic -eq 0x20b) { $dd = $opt + 112 } else { $dd = $opt + 96 }
      $clrSize = [BitConverter]::ToUInt32($b, $dd + 14 * 8 + 4)
      $info.assemblyDotnet = ($clrSize -gt 0)
    } finally { $fs.Close() }
  } catch { }
  return $info
}

function Get-VersionInfo {
  param([string]$File)
  try {
    $v = (Get-Item -LiteralPath $File -Force).VersionInfo
    $o = [ordered]@{}
    # certaines ressources de version contiennent des entités XML (ex. explorer.exe en français : d&apos;exploitation)
    $dec = { param($s) [System.Net.WebUtility]::HtmlDecode([string]$s).Trim() }
    if ($v.ProductName) { $o.produit = & $dec $v.ProductName }
    if ($v.FileDescription) { $o.description = & $dec $v.FileDescription }
    if ($v.CompanyName) { $o.editeur = & $dec $v.CompanyName }
    if ($v.ProductVersion) { $o.versionProduit = $v.ProductVersion.Trim() }
    if ($v.FileVersion) { $o.versionFichier = $v.FileVersion.Trim() }
    if ($v.OriginalFilename) { $o.nomOriginal = $v.OriginalFilename.Trim() }
    return $o
  } catch { return $null }
}

# Recherche de motifs (regex) dans un binaire, par blocs de 16 Mo décodés en Latin-1 (1 octet = 1 caractère).
function Search-Binary {
  param([string]$File, [hashtable]$Patterns, [string[]]$Multi = @(), [int]$MaxMB = 600, [int]$MultiCap = 60)
  $found = @{}
  try { $len = (Get-Item -LiteralPath $File -Force).Length } catch { return $found }
  if ($len -gt ([long]$MaxMB * 1MB)) {
    $script:warnings.Add(('Exécutable de {0} Mo non parcouru (limite -MaxScanMB {1}).' -f [Math]::Round($len / 1MB), $MaxMB))
    return $found
  }
  $enc = [Text.Encoding]::GetEncoding(28591)
  $rx = @{}
  foreach ($k in $Patterns.Keys) { $rx[$k] = New-Object System.Text.RegularExpressions.Regex($Patterns[$k], [System.Text.RegularExpressions.RegexOptions]::CultureInvariant) }
  $pending = New-Object System.Collections.Generic.List[string]
  foreach ($k in $Patterns.Keys) { $pending.Add($k) }
  $chunk = 16MB; $overlap = 512
  $buf = New-Object byte[] $chunk
  $fs = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $pos = [long]0
    while ($pending.Count -gt 0) {
      $fs.Position = $pos
      $n = 0
      while ($n -lt $chunk) { $r = $fs.Read($buf, $n, $chunk - $n); if ($r -le 0) { break }; $n += $r }
      if ($n -le 0) { break }
      $s = $enc.GetString($buf, 0, $n)
      foreach ($k in @($pending)) {
        if ($Multi -contains $k) {
          if (-not $found.ContainsKey($k)) { $found[$k] = New-Object System.Collections.Generic.List[string] }
          foreach ($m in $rx[$k].Matches($s)) {
            if ($found[$k].Count -ge $MultiCap) { break }
            if (-not $found[$k].Contains($m.Value)) { $found[$k].Add($m.Value) }
          }
          if ($found[$k].Count -ge $MultiCap) { [void]$pending.Remove($k) }
        } else {
          $m = $rx[$k].Match($s)
          if ($m.Success) {
            $found[$k] = [pscustomobject]@{ value = $m.Value; group1 = $m.Groups[1].Value; offset = $pos + $m.Index }
            [void]$pending.Remove($k)
          }
        }
      }
      if ($n -lt $chunk) { break }
      $pos += $n - $overlap
    }
  } finally { $fs.Close() }
  foreach ($k in @($found.Keys)) { if ($Multi -contains $k -and $found[$k].Count -eq 0) { $found.Remove($k) } }
  return $found
}

function Read-Fuses {
  param([string]$File, [long]$Offset)
  # Après la sentinelle (32 octets) : version (1 octet), nombre de fusibles (1 octet), puis un octet par
  # fusible : '1' activé, '0' désactivé, 'r' retiré.
  $names = @('RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable',
    'EnableNodeCliInspectArguments', 'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar',
    'LoadBrowserProcessSpecificV8Snapshot', 'GrantFileProtocolExtraPrivileges', 'WasmTrapHandlers')
  try {
    $fs = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $fs.Position = $Offset + 32
      $b = New-Object byte[] 66
      $n = $fs.Read($b, 0, 66)
      if ($n -lt 2) { return $null }
      $ver = $b[0]; $cnt = [Math]::Min([int]$b[1], $n - 2)
      $o = [ordered]@{ schema = [int]$ver }
      for ($i = 0; $i -lt $cnt; $i++) {
        $nm = if ($i -lt $names.Count) { $names[$i] } else { 'fusible' + $i }
        switch ($b[2 + $i]) {
          0x31 { $o[$nm] = 'active' }
          0x30 { $o[$nm] = 'desactive' }
          0x72 { $o[$nm] = 'retire' }
          default { $o[$nm] = ('0x{0:X2}' -f $b[2 + $i]) }
        }
      }
      return $o
    } finally { $fs.Close() }
  } catch { return $null }
}

# --- archives asar (Electron) : en-tête = Pickle { uint32 4, uint32 taille } + Pickle { uint32, uint32 longueur, JSON }
function Read-AsarHeader {
  param([string]$File)
  try {
    $fs = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $b = New-Object byte[] 16
      if ($fs.Read($b, 0, 16) -lt 16) { return $null }
      $headerSize = [BitConverter]::ToUInt32($b, 4)
      $jsonLen = [BitConverter]::ToUInt32($b, 12)
      if ($jsonLen -le 0 -or $jsonLen -gt 64MB) { return $null }
      $j = New-Object byte[] $jsonLen
      $r = 0
      while ($r -lt $jsonLen) { $k = $fs.Read($j, $r, $jsonLen - $r); if ($k -le 0) { break }; $r += $k }
      $obj = ConvertFrom-JsonSafe ([Text.Encoding]::UTF8.GetString($j, 0, $r))
      if ($null -eq $obj) { return $null }
      return @{ header = $obj; base = [long](8 + $headerSize); file = $File; headerBytes = $jsonLen }
    } finally { $fs.Close() }
  } catch { return $null }
}

function Read-AsarText {
  param($Asar, [string]$Rel, [int]$MaxBytes = 2MB)
  $node = $Asar.header
  foreach ($seg in ($Rel -split '/')) {
    $files = Get-Prop $node 'files'
    if ($null -eq $files) { return $null }
    $node = Get-Prop $files $seg
    if ($null -eq $node) { return $null }
  }
  if (Get-Prop $node 'unpacked') {
    return Read-TextSafe -File ($Asar.file + '.unpacked\' + ($Rel -replace '/', '\')) -MaxBytes $MaxBytes
  }
  $size = [long](Get-Prop $node 'size')
  $off = [long](Get-Prop $node 'offset')
  if ($size -le 0 -or $size -gt $MaxBytes) { return $null }
  try {
    $fs = [IO.File]::Open($Asar.file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $fs.Position = $Asar.base + $off
      $buf = New-Object byte[] $size
      $r = 0
      while ($r -lt $size) { $k = $fs.Read($buf, $r, $size - $r); if ($k -le 0) { break }; $r += $k }
      return [Text.Encoding]::UTF8.GetString($buf, 0, $r)
    } finally { $fs.Close() }
  } catch { return $null }
}

function Get-AsarHtml {
  param($Node, [string]$Prefix, [int]$Depth, [System.Collections.Generic.List[string]]$Acc, [ref]$Visited)
  $files = Get-Prop $Node 'files'
  if ($null -eq $files -or $Depth -gt 8 -or $Acc.Count -ge 40 -or $Visited.Value -gt 30000) { return }
  foreach ($k in (Get-Keys $files)) {
    $Visited.Value++
    if ($Acc.Count -ge 40) { return }
    $child = Get-Prop $files $k
    $rel = if ($Prefix) { $Prefix + '/' + $k } else { $k }
    if ($null -ne (Get-Prop $child 'files')) {
      if ($k -ne 'node_modules' -and $k -ne '.git') { Get-AsarHtml -Node $child -Prefix $rel -Depth ($Depth + 1) -Acc $Acc -Visited $Visited }
    } elseif ($k -match '\.html?$') { $Acc.Add($rel) }
  }
}

function Get-FolderHtml {
  param([string]$Dir, [int]$MaxDepth = 9, [int]$Cap = 40)
  $acc = New-Object System.Collections.Generic.List[string]
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue([pscustomobject]@{ p = $Dir; d = 0 })
  $dirs = 0
  while ($queue.Count -gt 0 -and $acc.Count -lt $Cap -and $dirs -lt 4000) {
    $cur = $queue.Dequeue(); $dirs++
    try { $infos = (New-Object IO.DirectoryInfo($cur.p)).GetFileSystemInfos() } catch { continue }
    foreach ($i in $infos) {
      if ($i -is [IO.DirectoryInfo]) {
        if ($cur.d -lt $MaxDepth -and $i.Name -notmatch '^(node_modules|extensions|\.git|test|tests|locales?)$') { $queue.Enqueue([pscustomobject]@{ p = $i.FullName; d = $cur.d + 1 }) }
      } elseif ($i.Name -match '\.html?$' -and $acc.Count -lt $Cap) {
        $acc.Add(($i.FullName.Substring($Dir.Length).TrimStart('\', '/') -replace '\\', '/'))
      }
    }
  }
  return , $acc
}

$script:uiDepsRx = '^(react|react-dom|preact|vue|svelte|@sveltejs/kit|solid-js|lit|@angular/core|jquery|next|nuxt|@mui/material|@material-ui/core|antd|@chakra-ui/react|@mantine/core|bootstrap|tailwindcss|@radix-ui/.+|@headlessui/react|styled-components|@emotion/react|@fluentui/.+|@blueprintjs/core|semantic-ui-react|monaco-editor|@xterm/xterm|xterm|lucide-react|@tabler/icons.*|@heroicons/react|react-router|react-router-dom|vue-router|@tanstack/.+|redux|@reduxjs/toolkit|mobx|zustand|@electron/remote|electron-store|@tauri-apps/api|codemirror|@codemirror/.+|d3|chart\.js|recharts|echarts|three|framer-motion|i18next|react-i18next|vue-i18n)$'

function Get-PackageSummary {
  param([string]$Text)
  $pkg = ConvertFrom-JsonSafe $Text
  if ($null -eq $pkg) { return $null }
  $o = [ordered]@{}
  foreach ($k in @('name', 'productName', 'version', 'main', 'type')) { $v = Get-Prop $pkg $k; if ($v) { $o[$k] = [string]$v } }
  $deps = @()
  foreach ($sec in @('dependencies', 'devDependencies', 'optionalDependencies')) {
    $d = Get-Prop $pkg $sec
    foreach ($k in (Get-Keys $d)) { $deps += [pscustomobject]@{ n = [string]$k; v = [string](Get-Prop $d $k) } }
  }
  $o.nombreDependances = @($deps).Count
  $ui = @($deps | Where-Object { $_.n -match $script:uiDepsRx } | ForEach-Object { $_.n + '@' + $_.v } | Select-Object -Unique)
  if ($ui.Count -gt 0) { $o.bibliothequesInterface = $ui }
  return $o
}

# ---------------------------------------------------------------------------------------------------------
# 1. Cible : chemin ou processus
# ---------------------------------------------------------------------------------------------------------
function Resolve-Target {
  param([string]$P)
  $p0 = [Environment]::ExpandEnvironmentVariables($P.Trim().Trim('"'))
  if (Test-Path -LiteralPath $p0) { return (Get-Item -LiteralPath $p0 -Force).FullName }
  $cmd = $null
  if ($p0 -notmatch '[\\/:]') { $cmd = Get-Command $p0 -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) {
    $src = $cmd.Source
    if ($src -match '\.(cmd|bat|ps1)$' -and (Split-Path (Split-Path $src -Parent) -Leaf) -ieq 'bin') { $src = Split-Path (Split-Path $src -Parent) -Parent }
    $script:warnings.Add("« $P » résolu comme commande : $src")
    return $src
  }
  $leaf = Split-Path $p0 -Leaf
  $exeLeaf = $null
  if ($leaf -match '\.exe$') { $exeLeaf = $leaf; $leaf = Split-Path (Split-Path $p0 -Parent) -Leaf }
  if (-not $leaf) { return $null }
  $bases = @()
  if ($env:LOCALAPPDATA) { $bases += (Join-Path $env:LOCALAPPDATA 'Programs') }
  if ($env:ProgramFiles) { $bases += $env:ProgramFiles }
  if (${env:ProgramFiles(x86)}) { $bases += ${env:ProgramFiles(x86)} }
  if ($env:LOCALAPPDATA) { $bases += $env:LOCALAPPDATA }
  if ($env:APPDATA) { $bases += $env:APPDATA }
  foreach ($b in $bases) {
    $cand = Join-Path $b $leaf
    if ($exeLeaf) { $cand = Join-Path $cand $exeLeaf }
    if (Test-Path -LiteralPath $cand) {
      $script:warnings.Add("Chemin « $P » introuvable ; analysé à la place : $cand")
      return (Get-Item -LiteralPath $cand -Force).FullName
    }
  }
  return $null
}

function Get-StartSafe($p) { try { return $p.StartTime } catch { return [datetime]::MaxValue } }

function Select-MainProcess {
  param([object[]]$Procs, [hashtable]$Cim)
  $scored = foreach ($p in $Procs) {
    $c = $Cim[[int]$p.Id]
    $cl = ''; if ($c) { $cl = [string]$c.CommandLine }
    $s = 0
    if ($cl -notmatch '--type=') { $s += 4 }
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $s += 2 }
    if (-not ($c -and $Cim.ContainsKey([int]$c.ParentProcessId))) { $s += 1 }
    [pscustomobject]@{ p = $p; s = $s; t = (Get-StartSafe $p) }
  }
  return ($scored | Sort-Object @{ Expression = { $_.s }; Descending = $true }, @{ Expression = { $_.t } } | Select-Object -First 1).p
}

function Get-CimByName([string]$ExeName) {
  $h = @{}
  if (-not $script:onWindows) { return $h }
  try {
    $f = "Name='" + ($ExeName -replace "'", "\'") + "'"
    foreach ($c in @(Get-CimInstance Win32_Process -Filter $f -ErrorAction Stop)) { $h[[int]$c.ProcessId] = $c }
  } catch { }
  return $h
}

function Get-ProcessDetails {
  param($Proc)
  $d = [ordered]@{ pid = $Proc.Id; nom = $Proc.ProcessName; titreFenetre = $null; modulesCles = @(); enfants = @() }
  try { if ($Proc.MainWindowTitle) { $d.titreFenetre = $Proc.MainWindowTitle } } catch { }
  $mods = @()
  try { $mods = @($Proc.Modules | ForEach-Object { $_.ModuleName.ToLowerInvariant() } | Select-Object -Unique) }
  catch { $script:warnings.Add('Modules du processus illisibles (processus élevé, protégé ou d''une autre architecture) : analyse par fichiers seulement.') }
  $d._mods = $mods
  if ($script:onWindows) {
    try {
      $kids = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $Proc.Id) -ErrorAction Stop)
      $d.enfants = @($kids | ForEach-Object { $_.Name } | Group-Object | ForEach-Object { if ($_.Count -gt 1) { '{0} x{1}' -f $_.Name, $_.Count } else { $_.Name } })
      $d._kids = @($kids | ForEach-Object { [string]$_.Name + ' ' + [string]$_.CommandLine })
    } catch { $d._kids = @() }
  } else { $d._kids = @() }
  return $d
}

$given = @(@($Path, $ProcessName, $ProcessId) | Where-Object { $_ })
if ($given.Count -gt 1) {
  Fail 'Indiquer une seule cible : -Path, -ProcessName ou -ProcessId (pas plusieurs).' @(
    'Exemple : detect_app.ps1 -Path "C:\Program Files\MonAppli"', 'Exemple : detect_app.ps1 -ProcessId 10580')
}
$mode = 'Path'
if ($ProcessName) { $mode = 'Name' }
elseif ($ProcessId) {
  $mode = 'Id'
  if ($ProcessId -notmatch '^\s*\d+\s*$') {
    Fail ('PID invalide : « {0} » (un nombre entier est attendu).' -f $ProcessId) @(
      'Trouver le PID de l''appli : Get-Process -Name <nom> | Select-Object Id, StartTime (sans lire les titres des fenêtres de l''utilisateur)',
      'Ou utiliser -ProcessName <nom du processus>')
  }
  $pidNum = [int]$ProcessId.Trim()
}
$exe = $null; $root = $null; $proc = $null; $procDetails = $null

if ($mode -eq 'Name' -or $mode -eq 'Id') {
  $cands = @(); $cim = @{}
  if ($mode -eq 'Name') {
    $n = $ProcessName -replace '\.exe$', ''
    $cands = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
    if ($cands.Count -gt 0) { $cim = Get-CimByName ($cands[0].ProcessName + '.exe') }
  } else {
    $cands = @(Get-Process -Id $pidNum -ErrorAction SilentlyContinue)
    if ($cands.Count -gt 0 -and $script:onWindows) {
      try { foreach ($c in @(Get-CimInstance Win32_Process -Filter ("ProcessId=" + $pidNum) -ErrorAction Stop)) { $cim[[int]$c.ProcessId] = $c } } catch { }
    }
  }
  if ($cands.Count -eq 0) {
    $msg = $(if ($mode -eq 'Id') { 'Aucun processus avec le PID {0} (déjà fermé, ou PID mal recopié).' -f $pidNum } else { 'Aucun processus nommé « {0} » en cours (nom sans .exe, tel qu''affiché par Get-Process).' -f ($ProcessName -replace '\.exe$', '') })
    Fail $msg @(
      'Retrouver le PID : Get-Process -Name <nom> | Select-Object Id, StartTime (un lanceur peut avoir laissé la place à un autre processus)',
      'Ou analyser le dossier d''installation : -Path "<dossier ou exe>"')
  }
  $proc = Select-MainProcess -Procs $cands -Cim $cim
  if ($cands.Count -gt 1) { $script:notes.Add(('{0} processus « {1} » ; analysé : PID {2} (processus principal présumé).' -f $cands.Count, $proc.ProcessName, $proc.Id)) }
  try { $exe = $proc.Path } catch { }
  if (-not $exe -and $cim.ContainsKey([int]$proc.Id)) { $exe = [string]$cim[[int]$proc.Id].ExecutablePath }
  if (-not $exe) { Fail ('Chemin de l''exécutable du PID {0} illisible (processus protégé ?).' -f $proc.Id) @('Essayer -Path avec le dossier d''installation.') }
  $root = Split-Path -Parent $exe
  $procDetails = Get-ProcessDetails $proc
} else {
  if (-not $Path) {
    Fail 'Indiquer -Path <dossier, .exe ou .lnk>, -ProcessName <nom> ou -ProcessId <pid>.' @(
      'Exemple : detect_app.ps1 -Path "C:\Program Files\MonAppli"', 'Exemple : detect_app.ps1 -ProcessName notepad')
  }
  $resolved = Resolve-Target $Path
  if (-not $resolved) {
    Fail ('Chemin introuvable : {0}' -f $Path) @(
      'Installations « par utilisateur » : %LOCALAPPDATA%\Programs\<Appli> (ex. VS Code, Discord dans %LOCALAPPDATA%\<Appli>)',
      'Depuis le menu Démarrer : clic droit sur l''appli > Ouvrir l''emplacement du fichier',
      'Appli déjà ouverte : -ProcessName <nom du processus>')
  }
  if ($resolved -match '\.lnk$') {
    $t = $null
    if ($script:onWindows) { try { $t = (New-Object -ComObject WScript.Shell).CreateShortcut($resolved).TargetPath } catch { } }
    if ($t -and (Test-Path -LiteralPath $t)) { $script:notes.Add("Raccourci résolu : $t"); $resolved = $t }
    else {
      # Raccourci d'appli du Store / MSIX (cible vide) ou cible disparue : analyser le dossier du raccourci
      # (souvent le Bureau) n'aurait aucun sens.
      Fail ('Raccourci sans cible exploitable : {0}' -f $resolved) @(
        'Appli du Store / MSIX : l''ouvrir puis relancer avec -ProcessName <nom du processus> (ou -ProcessId)',
        'Sinon, indiquer le dossier d''installation : -Path "<dossier ou exe>"')
    }
  }
  $it = Get-Item -LiteralPath $resolved -Force
  if ($it.PSIsContainer) { $root = $it.FullName }
  elseif ($it.Extension -ieq '.exe' -or -not $script:onWindows) { $exe = $it.FullName; $root = $it.DirectoryName }
  else {
    $root = $it.DirectoryName
    $script:warnings.Add(('« {0} » n''est pas un exécutable : analyse de son dossier ({1}).' -f $it.Name, $root))
  }
  # Lanceur d'une appli du Store dans le dossier Windows (Windows 11 : notepad.exe, mspaint.exe...) : on analyse
  # le paquet MSIX installé, sans lancer l'appli (la lancer pour la détection rouvrirait la session de l'utilisateur).
  if ($exe -and $script:onWindows -and $env:SystemRoot -and $exe.ToLowerInvariant().StartsWith($env:SystemRoot.ToLowerInvariant() + '\')) {
    $baseL = [IO.Path]::GetFileNameWithoutExtension($exe).ToLowerInvariant()
    $known = @{ notepad = 'Microsoft.WindowsNotepad'; mspaint = 'Microsoft.Paint'; calc = 'Microsoft.WindowsCalculator'; snippingtool = 'Microsoft.ScreenSketch'; wt = 'Microsoft.WindowsTerminal'; sndrec32 = 'Microsoft.WindowsSoundRecorder' }
    $pkg = $null
    if ($baseL -notin @('explorer', 'cmd', 'powershell', 'regedit', 'taskmgr', 'mmc', 'control', 'rundll32', 'svchost', 'conhost')) {
      try {
        if ($known.ContainsKey($baseL)) { $pkg = @(Get-AppxPackage -Name $known[$baseL] -ErrorAction Stop | Where-Object { $_.InstallLocation })[0] }
        if (-not $pkg -and $baseL.Length -ge 4) { $pkg = @(Get-AppxPackage -Name ('*' + $baseL + '*') -ErrorAction Stop | Where-Object { $_.InstallLocation -and -not $_.IsFramework })[0] }
      } catch { $pkg = $null }
    }
    if ($pkg -and (Test-Path -LiteralPath $pkg.InstallLocation)) {
      $script:warnings.Add(('« {0} » n''est qu''un lanceur de l''appli du Store {1} {2} : analyse du paquet installé ({3}), sans lancer l''appli.' -f (Split-Path $exe -Leaf), $pkg.Name, $pkg.Version, $pkg.InstallLocation))
      $root = $pkg.InstallLocation.TrimEnd('\'); $exe = $null
    }
  }
}

# ---------------------------------------------------------------------------------------------------------
# 2. Inventaire des fichiers (profondeur limitée)
# ---------------------------------------------------------------------------------------------------------
$maxDepth = 3
$rootLow = $root.TrimEnd('\', '/').ToLowerInvariant()
$wide = @()
foreach ($w in @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:APPDATA, $env:USERPROFILE, $env:ProgramData)) {
  if ($w) { $wide += $w.TrimEnd('\').ToLowerInvariant() }
}
if ($env:SystemRoot) { $wide += (Join-Path $env:SystemRoot 'System32').ToLowerInvariant(); $wide += (Join-Path $env:SystemRoot 'SysWOW64').ToLowerInvariant() }
if ($env:LOCALAPPDATA) { $wide += (Join-Path $env:LOCALAPPDATA 'Programs').ToLowerInvariant() }
if ($env:ProgramFiles) { $wide += (Join-Path $env:ProgramFiles 'WindowsApps').ToLowerInvariant() }
if (($wide -contains $rootLow) -or ($root -match '^[A-Za-z]:\\?$') -or ($root -eq '/')) {
  $maxDepth = 0
  $script:wideRoot = $true
  $script:warnings.Add("Dossier système ou partagé ($root) : seule sa racine est examinée. Indiquer plutôt le dossier propre à l'appli.")
  if ($mode -eq 'Path' -and $env:SystemRoot -and $rootLow.StartsWith($env:SystemRoot.ToLowerInvariant())) {
    $script:warnings.Add('Sous Windows 11, plusieurs applis intégrées (Bloc-notes, Paint, Terminal...) sont des applis du Store : l''exe du dossier Windows n''est qu''un lanceur. Si c''est le cas ici, analyser le paquet sans lancer l''appli : -Path (Get-AppxPackage *<nom>*).InstallLocation ; ou viser l''appli déjà ouverte avec -ProcessId <PID>.')
  }
}

$tree = New-Object System.Collections.Generic.List[object]
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue([pscustomobject]@{ p = $root; d = 0 })
$cap = 25000
$skipDirs = '^(node_modules|locales|\.git|extensions|dictionaries|widevinecdm|__pycache__|site-packages|translations|i18n|lang|languages|help|docs?|samples?|licenses?)$'
while ($queue.Count -gt 0 -and $tree.Count -lt $cap) {
  $cur = $queue.Dequeue()
  try { $infos = (New-Object IO.DirectoryInfo($cur.p)).GetFileSystemInfos() } catch { continue }
  foreach ($i in $infos) {
    if ($tree.Count -ge $cap) { break }
    $rel = ($i.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/')
    $isDir = $i -is [IO.DirectoryInfo]
    $len = 0L; if (-not $isDir) { $len = $i.Length }
    $tree.Add([pscustomobject]@{ rel = $rel; low = $rel.ToLowerInvariant(); dir = $isDir; depth = $cur.d; full = $i.FullName; len = $len; name = $i.Name })
    if ($isDir -and $cur.d -lt $maxDepth -and $i.Name -notmatch $skipDirs) { $queue.Enqueue([pscustomobject]@{ p = $i.FullName; d = $cur.d + 1 }) }
  }
}
if ($tree.Count -ge $cap) { $script:warnings.Add("Inventaire limité à $cap entrées : dossier très volumineux, indices peut-être incomplets.") }

$byLow = @{}
foreach ($e in $tree) { $byLow[$e.low] = $e }
$script:allPaths = [string]::Join("`n", @($tree | ForEach-Object { $_.low }))

function Find-Rel {
  param([string]$Pattern)
  $r = New-Object System.Collections.Generic.List[object]
  if (-not $script:allPaths) { return , $r }
  # les chemins sont joints par des sauts de ligne : une classe [^/] ne doit pas les traverser
  # (sinon recherche quadratique et correspondances à cheval sur plusieurs lignes)
  $Pattern = $Pattern.Replace('[^/]', '[^/\n]')
  foreach ($m in [regex]::Matches($script:allPaths, '(?m)^(?:[^\n]*/)?(?:' + $Pattern + ')$')) {
    $e = $byLow[$m.Value]
    if ($e) { $r.Add($e) }
  }
  return , $r
}

# --- exécutable principal : exe à interface graphique d'abord, puis le moins profond, puis celui dont le nom
#     ressemble au dossier, puis le dossier app-x.y.z le plus récent (Squirrel), puis le plus gros.
$script:exeExclude = '^(unins\d*|uninstall.*|update|squirrel|.*crashpad.*|crash_?handler.*|crashreporter.*|.*elevation_service|elevated_tracing_service|notification_helper|setup.*|.*installer.*|.*_proxy|chrome_pwa_launcher|new_.*|os_update_handler|createdump|.*helper.*|.*updater.*|vc_?redist.*|.*webview2.*|qtwebengineprocess|cefsharp\.browsersubprocess|.*-cmd|code-tunnel|pingsender|default-browser-agent|maintenanceservice.*|unitycrashhandler.*|pythonw?\d*|javaw?|jabswitch|keytool|.*\.vshost)\.exe$'
function Select-MainExe {
  $rootName = (Split-Path $root -Leaf).ToLowerInvariant() -replace '[^a-z0-9]', ''
  $exes = @($tree | Where-Object { -not $_.dir -and $_.low -match '\.exe$' -and $_.depth -le 2 } | Sort-Object depth | Select-Object -First 200)
  $good = @($exes | Where-Object { $_.name -notmatch $script:exeExclude })
  if ($good.Count -eq 0) { $good = $exes }
  $best = $good | Sort-Object @{ Expression = { $pe = Get-PeInfo $_.full; if ($pe -and $pe.interfaceGraphique) { 0 } else { 1 } } }, @{ Expression = { $_.depth } }, @{ Expression = {
      $b = ($_.name -replace '\.exe$', '').ToLowerInvariant() -replace '[^a-z0-9]', ''
      if ($b -and $rootName -and ($rootName.Contains($b) -or $b.Contains($rootName))) { 0 } else { 1 } } }, @{ Expression = {
      $seg = ($_.rel -split '/')[0]
      if ($seg -match '^app-(\d+(?:\.\d+)+)$') { try { [version]$Matches[1] } catch { [version]'0.0' } } else { [version]'0.0' } }; Descending = $true }, @{ Expression = { $_.len }; Descending = $true } | Select-Object -First 1
  if ($best) { return $best.full }
  return $null
}
if (-not $exe -and $script:onWindows) { $exe = Select-MainExe }
elseif ($exe -and $mode -eq 'Path' -and ((Split-Path $exe -Leaf) -match $script:exeExclude)) {
  # ex. Update.exe de Squirrel (Discord, Slack...) : c'est le programme de mise à jour, pas l'appli
  $alt = Select-MainExe
  if ($alt -and $alt -ne $exe) { $script:warnings.Add(('« {0} » est un programme annexe (mise à jour, désinstallation...) ; analysé à la place : {1}' -f (Split-Path $exe -Leaf), $alt)); $exe = $alt }
}
if (-not $exe -and -not $script:onWindows) {
  $mac = @($tree | Where-Object { -not $_.dir -and $_.low -match '^contents/macos/[^/]+$' } | Select-Object -First 1)
  if ($mac.Count -gt 0) { $exe = $mac[0].full }
}
$exeDir = $null
if ($exe) { $exeDir = Split-Path -Parent $exe }

# Le processus de l'exe tourne-t-il déjà ? (lecture des modules seulement, aucun effet sur l'appli)
$running = @()
if ($exe -and $script:onWindows) {
  $base = [IO.Path]::GetFileNameWithoutExtension($exe)
  $running = @(Get-Process -Name $base -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $exe } catch { $false } })
  if (-not $procDetails -and $running.Count -gt 0) {
    $cimR = Get-CimByName ($base + '.exe')
    $main = Select-MainProcess -Procs $running -Cim $cimR
    $procDetails = Get-ProcessDetails $main
    $script:notes.Add(('L''appli est déjà ouverte (PID {0}) : modules chargés lus en plus des fichiers (aucune action sur le processus).' -f $main.Id))
  }
}

# ---------------------------------------------------------------------------------------------------------
# 3. Indices par fichiers
# ---------------------------------------------------------------------------------------------------------
$fileRules = @(
  @('electron', 5, 'resources/app\.asar', 'archive resources\app.asar'),
  @('electron', 5, 'resources/app/package\.json', 'dossier resources\app\ (appli Electron non archivée)'),
  @('electron', 2, 'resources/(?:default_app|electron)\.asar', 'archive Electron par défaut'),
  @('electron', 2, 'licenses\.chromium\.html', 'LICENSES.chromium.html (Chromium embarqué)'),
  @('electron', 6, 'electron framework\.framework', 'Electron Framework.framework (macOS)'),
  @('chromium-browser', 6, '(?:chrome|msedge)\.dll', 'chrome.dll / msedge.dll (navigateur Chromium)'),
  @('chromium-browser', 1, '(?:chrome|msedge)_elf\.dll', 'chrome_elf.dll'),
  @('gecko', 7, 'xul\.dll', 'xul.dll (moteur Gecko de Firefox / Thunderbird)'),
  @('cef', 7, 'libcef\.dll', 'libcef.dll (Chromium Embedded Framework)'),
  @('cef', 3, 'cefsharp(?:\.core(?:\.runtime)?)?\.dll', 'CefSharp (CEF pour .NET)'),
  @('nwjs', 7, 'nw\.dll|nw_elf\.dll|package\.nw', 'NW.js (nw.dll / package.nw)'),
  @('webview2', 4, 'webview2loader\.dll', 'WebView2Loader.dll'),
  @('webview2', 4, 'microsoft\.web\.webview2\.core\.dll', 'Microsoft.Web.WebView2.Core.dll'),
  @('webview2', 1, 'microsoft\.web\.webview2\.(?:wpf|winforms)\.dll', 'contrôle WebView2 WPF/WinForms'),
  @('flutter', 8, 'flutter_windows\.dll', 'flutter_windows.dll'),
  @('flutter', 2, 'data/flutter_assets', 'data\flutter_assets'),
  @('flutter', 7, 'flutter(?:macos)?\.framework', 'Flutter.framework (macOS)'),
  @('unity', 8, 'unityplayer\.dll', 'UnityPlayer.dll'),
  @('unreal', 8, '[^/]*-win64-shipping\.exe', 'exécutable *-Win64-Shipping (Unreal)'),
  @('unreal', 3, 'engine/binaries', 'Engine\Binaries (Unreal)'),
  @('godot', 3, '[^/]+\.pck', 'archive .pck (Godot)'),
  @('avalonia', 6, 'avalonia(?:\.[a-z0-9]+)*\.dll', 'Avalonia*.dll'),
  @('maui', 6, 'microsoft\.maui(?:\.[a-z0-9]+)*\.dll', 'Microsoft.Maui*.dll'),
  @('winui3', 5, 'microsoft\.ui\.xaml\.dll', 'Microsoft.UI.Xaml.dll (WinUI 3)'),
  @('winui3', 4, 'microsoft\.windowsappruntime\.bootstrap\.dll', 'Windows App SDK (bootstrap)'),
  @('wpf', 3, 'presentationframework\.dll', 'PresentationFramework.dll'),
  @('wpf', 3, 'wpfgfx_cor3\.dll', 'wpfgfx_cor3.dll'),
  @('winforms', 3, 'system\.windows\.forms\.dll', 'System.Windows.Forms.dll'),
  @('dotnet', 2, '[^/]+\.runtimeconfig\.json', '*.runtimeconfig.json (.NET 5+)'),
  @('dotnet', 1, '[^/]+\.deps\.json', '*.deps.json'),
  @('dotnet', 1, '[^/]+\.exe\.config', '*.exe.config (.NET Framework)'),
  @('dotnet', 2, 'coreclr\.dll', 'coreclr.dll (.NET autonome)'),
  @('qt', 7, 'qt[56]core\.dll|qtcore4\.dll|qt[56]cored\.dll', 'Qt5Core/Qt6Core.dll'),
  @('qt', 2, 'platforms/qwindows\.dll', 'platforms\qwindows.dll'),
  @('qt', 6, 'plugins/gui/libqt_plugin\.dll', 'module d''interface Qt (VLC)'),
  @('qt', 7, 'qtcore\.framework', 'QtCore.framework (macOS)'),
  @('java', 7, 'jvm\.dll|libjvm\.(?:so|dylib)', 'jvm.dll (machine virtuelle Java embarquée)'),
  @('java', 2, '[^/]+\.jar', 'archives .jar'),
  @('java', 2, '(?:jre|runtime|jbr)/release', 'environnement Java embarqué'),
  @('delphi', 6, 'borlndmm\.dll', 'borlndmm.dll (Delphi/C++Builder)'),
  @('delphi', 3, '[^/]+\.bpl', 'paquets .bpl (Delphi)'),
  @('wx', 6, 'wxmsw[^/]*\.dll|wxbase[^/]*\.dll', 'DLL wxWidgets'),
  @('gtk', 6, 'libgtk-[34][^/]*\.dll', 'DLL GTK'),
  @('tkinter', 4, 'tk\d+t?\.dll', 'tk86t.dll (Tkinter)'),
  @('python', 3, 'python\d+\.dll', 'pythonXY.dll embarqué'),
  @('python', 2, 'base_library\.zip', 'base_library.zip (PyInstaller)'),
  @('mfc', 3, 'mfc\d+u?\.dll', 'DLL MFC')
)
foreach ($rule in $fileRules) {
  if ($script:wideRoot) { break }   # dossier système : ses DLL ne disent rien de l'appli
  $hits = Find-Rel $rule[2]
  if ($hits.Count -gt 0) {
    $ex = $hits[0].rel
    $suffix = ''; if ($hits.Count -gt 1) { $suffix = ' (x' + $hits.Count + ')' }
    Add-Hint $rule[0] $rule[1] ($rule[3] + ' : ' + $ex + $suffix)
  }
}
$qtExtras = @()
if ((Find-Rel 'qt[56]quick\.dll').Count -gt 0) { $qtExtras += 'Qt Quick / QML' }
if ((Find-Rel 'qt[56]widgets\.dll').Count -gt 0) { $qtExtras += 'Qt Widgets' }
if ((Find-Rel 'qt[56]webenginecore\.dll|qtwebengineprocess\.exe').Count -gt 0) { $qtExtras += 'Qt WebEngine (contenu web : débogable via QTWEBENGINE_REMOTE_DEBUGGING)' }
$javaExtras = @()
if ((Find-Rel 'javafx[^/]*\.(?:jar|dll)|glass\.dll|prism_d3d\.dll').Count -gt 0) { $javaExtras += 'JavaFX' }
if ((Find-Rel 'swt[^/]*\.(?:jar|dll)').Count -gt 0) { $javaExtras += 'SWT (Eclipse)' }

# --- .NET : manifestes runtimeconfig / deps
$dotnet = [ordered]@{}
foreach ($rc in (Find-Rel '[^/]+\.runtimeconfig\.json')) {
  if ($rc.depth -gt 1) { continue }
  $j = ConvertFrom-JsonSafe (Read-TextSafe $rc.full)
  $ro = Get-Prop $j 'runtimeOptions'
  $fws = @()
  $f1 = Get-Prop $ro 'framework'; if ($f1) { $fws += [string](Get-Prop $f1 'name') }
  foreach ($f in @(Get-Prop $ro 'frameworks')) { if ($f) { $fws += [string](Get-Prop $f 'name') } }
  foreach ($f in @(Get-Prop $ro 'includedFrameworks')) { if ($f) { $fws += [string](Get-Prop $f 'name') } }
  $fws = @($fws | Where-Object { $_ } | Select-Object -Unique)
  if ($fws.Count -gt 0) { $dotnet.frameworks = $fws; $dotnet.runtime = '.NET 5+ (Core)' }
  if ($fws -contains 'Microsoft.WindowsDesktop.App') { $script:notes.Add('.NET : framework Microsoft.WindowsDesktop.App (WPF ou WinForms).') }
  if ($fws -contains 'Microsoft.AspNetCore.App') { $script:notes.Add('.NET : ASP.NET Core présent (serveur web local possible : l''interface est peut-être servie en HTTP).') }
  break
}
foreach ($dj in (Find-Rel '[^/]+\.deps\.json')) {
  if ($dj.depth -gt 1) { continue }
  $t = Read-TextSafe -File $dj.full -MaxBytes 8MB
  if (-not $t) { continue }
  if ($t -match 'Microsoft\.Maui') { Add-Hint 'maui' 5 'deps.json : Microsoft.Maui' }
  if ($t -match 'Avalonia') { Add-Hint 'avalonia' 4 'deps.json : Avalonia' }
  if ($t -match 'Microsoft\.WindowsAppSDK') { Add-Hint 'winui3' 4 'deps.json : Microsoft.WindowsAppSDK' }
  if ($t -match 'Microsoft\.Web\.WebView2') { Add-Hint 'webview2' 3 'deps.json : Microsoft.Web.WebView2' }
  if ($t -match 'CefSharp') { Add-Hint 'cef' 4 'deps.json : CefSharp' }
  break
}

# --- exécutable principal : PE, version, assembly .NET
$peInfo = $null; $verInfo = $null; $managedFile = $null
if ($exe) {
  $peInfo = Get-PeInfo $exe
  $verInfo = Get-VersionInfo $exe
  if ($peInfo -and $peInfo.assemblyDotnet) {
    $managedFile = $exe
    Add-Hint 'dotnet' 3 ('exécutable .NET (en-tête CLR) : ' + (Split-Path $exe -Leaf))
    if (-not $dotnet.runtime) { $dotnet.runtime = '.NET Framework (ou assembly .NET)' }
  } else {
    $apphostDll = [IO.Path]::ChangeExtension($exe, '.dll')
    if (Test-Path -LiteralPath $apphostDll) {
      $pd = Get-PeInfo $apphostDll
      if ($pd -and $pd.assemblyDotnet) { $managedFile = $apphostDll; Add-Hint 'dotnet' 3 ('apphost .NET + assembly ' + (Split-Path $apphostDll -Leaf)) }
    }
  }
}
$ecrans = New-Object System.Collections.Generic.List[string]
$ecransSource = $null
if ($managedFile -and -not $NoBinaryScan) {
  $pats = @{
    wpf = 'PresentationFramework'; winforms = 'System\.Windows\.Forms'; avalonia = 'Avalonia\.'
    winui3 = 'Microsoft\.UI\.Xaml'; maui = 'Microsoft\.Maui'; webview2 = 'Microsoft\.Web\.WebView2'; cef = 'CefSharp'
    baml = '[A-Za-z0-9_/\-.]{1,100}\.baml'
  }
  $res = Search-Binary -File $managedFile -Patterns $pats -Multi @('baml') -MaxMB 128
  if ($res.ContainsKey('wpf')) { Add-Hint 'wpf' 5 'l''assembly principale référence PresentationFramework' }
  if ($res.ContainsKey('winforms')) { Add-Hint 'winforms' 5 'l''assembly principale référence System.Windows.Forms' }
  if ($res.ContainsKey('avalonia')) { Add-Hint 'avalonia' 5 'l''assembly principale référence Avalonia' }
  if ($res.ContainsKey('winui3')) { Add-Hint 'winui3' 5 'l''assembly principale référence Microsoft.UI.Xaml' }
  if ($res.ContainsKey('maui')) { Add-Hint 'maui' 5 'l''assembly principale référence Microsoft.Maui' }
  if ($res.ContainsKey('webview2')) { Add-Hint 'webview2' 3 'l''assembly principale référence WebView2' }
  if ($res.ContainsKey('cef')) { Add-Hint 'cef' 3 'l''assembly principale référence CefSharp' }
  if ($res.ContainsKey('baml')) {
    Add-Hint 'wpf' 2 'ressources .baml (vues XAML compilées)'
    foreach ($b in $res['baml']) { if ($ecrans.Count -lt 60) { $ecrans.Add($b) } }
    $ecransSource = 'noms des ressources .baml (fenêtres, pages et contrôles WPF ; noms seulement, rien n''est décompilé)'
  }
}

# --- MSIX / UWP : AppxManifest.xml dans le dossier ou ses parents
$paquet = $null
$manifestPath = $null
$probe = $root
for ($i = 0; $i -lt 4 -and $probe; $i++) {
  $cand = Join-Path $probe 'AppxManifest.xml'
  if (Test-Path -LiteralPath $cand) { $manifestPath = $cand; break }
  $probe = Split-Path -Parent $probe
}
if ($manifestPath) {
  try {
    [xml]$mx = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    $idn = $mx.Package.Identity
    $paquet = [ordered]@{ type = 'MSIX/AppX'; manifeste = $manifestPath; nom = [string]$idn.Name; version = [string]$idn.Version; editeur = [string]$idn.Publisher }
    $props = $mx.Package.Properties
    if ($props -and $props.PublisherDisplayName) { $paquet.editeurAffiche = [string]$props.PublisherDisplayName }
    $apps = @($mx.Package.Applications.Application)
    $paquet.applications = @($apps | ForEach-Object { [ordered]@{ id = [string]$_.Id; executable = [string]$_.Executable; pointEntree = [string]$_.EntryPoint } })
    $deps = @($mx.Package.Dependencies.PackageDependency | ForEach-Object { [string]$_.Name } | Where-Object { $_ })
    $paquet.dependances = $deps
    $fullTrust = @($apps | Where-Object { [string]$_.EntryPoint -eq 'Windows.FullTrustApplication' }).Count -gt 0
    $paquet.bureauEmpaquete = $fullTrust
    if (@($deps | Where-Object { $_ -match '^Microsoft\.WindowsAppRuntime' }).Count -gt 0) { Add-Hint 'winui3' 5 'dépendance Microsoft.WindowsAppRuntime (Windows App SDK, interface WinUI 3 presque toujours)' }
    if (@($deps | Where-Object { $_ -match '^Microsoft\.UI\.Xaml\.2' }).Count -gt 0) { Add-Hint 'uwp' 2 'dépendance Microsoft.UI.Xaml 2.x (WinUI 2)' }
    if (-not $fullTrust -and $apps.Count -gt 0) { Add-Hint 'uwp' 4 'point d''entrée UWP (pas FullTrust)' }
    if ($env:LOCALAPPDATA) {
      $pk = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter ($paquet.nom + '_*') -ErrorAction SilentlyContinue | Select-Object -First 1)
      if ($pk.Count -gt 0) { $paquet.familleDePaquet = $pk[0].Name }
    }
  } catch { $script:warnings.Add('AppxManifest.xml illisible : ' + $_.Exception.Message) }
}

# --- modules chargés et processus enfants
if ($procDetails) {
  $modRules = @(
    @('webview2', 5, '^embeddedbrowserwebview\.dll$', 'module EmbeddedBrowserWebView.dll chargé'),
    @('webview2', 3, '^(?:microsoft\.web\.webview2\.core|webview2loader)\.dll$', 'module WebView2 chargé'),
    @('cef', 6, '^libcef\.dll$', 'module libcef.dll chargé'),
    @('dotnet', 3, '^(?:clr|coreclr)\.dll$', 'runtime .NET chargé'),
    @('wpf', 6, '^(?:presentationframework|presentationcore|wpfgfx)[^ ]*\.dll$', 'modules WPF chargés'),
    @('winforms', 6, '^system\.windows\.forms(?:\.ni)?\.dll$', 'module System.Windows.Forms chargé'),
    @('winui3', 6, '^microsoft\.ui\.xaml\.dll$', 'module Microsoft.UI.Xaml.dll (WinUI 3) chargé'),
    @('uwp', 2, '^windows\.ui\.xaml\.dll$', 'module Windows.UI.Xaml.dll (XAML système) chargé'),
    @('qt', 6, '^qt[56]core\.dll$|^qtcore4\.dll$', 'module Qt Core chargé'),
    @('java', 6, '^jvm\.dll$', 'module jvm.dll chargé'),
    @('flutter', 7, '^flutter_windows\.dll$', 'module flutter_windows.dll chargé'),
    @('mfc', 4, '^mfc\d+u?\.dll$', 'module MFC chargé'),
    @('gtk', 6, '^libgtk-', 'module GTK chargé'),
    @('wx', 6, '^wxmsw', 'module wxWidgets chargé'),
    @('unity', 7, '^unityplayer\.dll$', 'module UnityPlayer.dll chargé'),
    @('avalonia', 6, '^avalonia', 'module Avalonia chargé'),
    @('python', 3, '^python\d+\.dll$', 'module Python chargé'),
    @('tkinter', 4, '^tk\d+t?\.dll$', 'module Tk chargé'),
    @('nwjs', 6, '^nw\.dll$', 'module nw.dll chargé'),
    @('delphi', 4, '^(?:borlndmm|rtl\d+)\.(?:dll|bpl)$', 'module Delphi chargé')
  )
  $keyMods = New-Object System.Collections.Generic.List[string]
  foreach ($rule in $modRules) {
    $hit = @($procDetails._mods | Where-Object { $_ -match $rule[2] })
    if ($hit.Count -gt 0) { Add-Hint $rule[0] $rule[1] ($rule[3] + ' (' + $hit[0] + ')'); foreach ($h in $hit) { if (-not $keyMods.Contains($h)) { $keyMods.Add($h) } } }
  }
  $procDetails.modulesCles = @($keyMods)
  $procDetails.nombreModules = @($procDetails._mods).Count
  $kids = @($procDetails._kids)
  if (@($kids | Where-Object { $_ -match '^msedgewebview2\.exe' }).Count -gt 0) { Add-Hint 'webview2' 5 'processus enfants msedgewebview2.exe' }
  if (@($kids | Where-Object { $_ -match '^qtwebengineprocess\.exe' }).Count -gt 0) { $qtExtras += 'Qt WebEngine (processus enfants)' }
  if (@($kids | Where-Object { $_ -match '^cefsharp\.browsersubprocess\.exe' }).Count -gt 0) { Add-Hint 'cef' 5 'processus enfants CefSharp.BrowserSubprocess.exe' }
  if (@($kids | Where-Object { $_ -match '--type=renderer' }).Count -gt 0) { $script:notes.Add('Processus enfants de rendu Chromium (--type=renderer) : interface web.') }
  $procDetails.Remove('_mods'); $procDetails.Remove('_kids')
}

# --- balayage de l'exécutable (Electron : version + fusibles ; sinon quelques signatures)
$electron = $null
$scan = @{}
$maxNow = 0; foreach ($v in $script:scores.Values) { if ($v -gt $maxNow) { $maxNow = $v } }
$isElectronish = (Get-Score 'electron') -ge 4
if ($exe -and -not $NoBinaryScan -and $script:onWindows) {
  if ($isElectronish) {
    $scan = Search-Binary -File $exe -MaxMB $MaxScanMB -Patterns @{
      fuse = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
      electron = 'Electron/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)'
      chrome = 'Chrome/(\d+\.\d+\.\d+\.\d+)'
    }
  } elseif ($maxNow -lt 5 -and -not $managedFile) {
    $scan = Search-Binary -File $exe -MaxMB ([Math]::Min($MaxScanMB, 300)) -Patterns @{
      fuse = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
      electron = 'Electron/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)'
      tauri = '__TAURI_|tauri\.localhost|tauri://localhost'
      delphi = 'Embarcadero|Borland Delphi|Delphi \d'
      wx = 'wxWidgets'
      webview2 = 'WebView2Loader|CreateCoreWebView2Environment'
      wpf = 'PresentationFramework'
      winforms = 'System\.Windows\.Forms'
      qt = 'qt_plugin_query_metadata|QApplication|QWidget'
      flutter = 'flutter_windows\.dll'
    }
    if ($scan.ContainsKey('tauri')) { Add-Hint 'tauri' 7 ('chaîne « ' + $scan['tauri'].value + ' » dans l''exécutable') }
    if ($scan.ContainsKey('delphi')) { Add-Hint 'delphi' 3 ('chaîne « ' + $scan['delphi'].value + ' » dans l''exécutable') }
    if ($scan.ContainsKey('wx')) { Add-Hint 'wx' 3 'chaîne « wxWidgets » dans l''exécutable' }
    if ($scan.ContainsKey('webview2')) { Add-Hint 'webview2' 3 ('chaîne « ' + $scan['webview2'].value + ' » dans l''exécutable (WebView2 lié statiquement)') }
    if ($scan.ContainsKey('wpf')) { Add-Hint 'wpf' 2 'chaîne PresentationFramework dans l''exécutable (appli .NET en fichier unique ?)' }
    if ($scan.ContainsKey('winforms')) { Add-Hint 'winforms' 2 'chaîne System.Windows.Forms dans l''exécutable (appli .NET en fichier unique ?)' }
    if ($scan.ContainsKey('qt')) { Add-Hint 'qt' 2 ('chaîne « ' + $scan['qt'].value + ' » dans l''exécutable (Qt lié statiquement ?)') }
    if ($scan.ContainsKey('flutter')) { Add-Hint 'flutter' 3 'l''exécutable importe flutter_windows.dll' }
  }
  if ($scan.ContainsKey('electron')) { Add-Hint 'electron' 4 ('chaîne « ' + $scan['electron'].value + ' » dans l''exécutable') }
  if ($scan.ContainsKey('fuse')) { Add-Hint 'electron' 3 'sentinelle des fusibles Electron dans l''exécutable' }
}

# ---------------------------------------------------------------------------------------------------------
# 4. Verdict
# ---------------------------------------------------------------------------------------------------------
if ($exe -and $peInfo -and -not $peInfo.assemblyDotnet -and $script:scores.Count -eq 0) { Add-Hint 'win32' 1 'exécutable natif sans autre indice' }
# Un navigateur Chromium ne doit pas l'emporter sur Electron/CEF/NW.js (et inversement)
if ((Get-Score 'chromium-browser') -gt 0 -and ((Get-Score 'electron') -ge 5 -or (Get-Score 'cef') -ge 5 -or (Get-Score 'nwjs') -ge 5)) { $script:scores['chromium-browser'] = 0.0 }
# Tauri utilise WebView2 : WebView2 devient secondaire
if ((Get-Score 'tauri') -ge 5 -and (Get-Score 'webview2') -gt 0) { $script:notes.Add('Tauri affiche son interface dans WebView2.') }
# .NET générique : s'efface devant la bibliothèque d'interface identifiée
foreach ($ui in @('wpf', 'winforms', 'avalonia', 'maui', 'winui3')) { if ((Get-Score $ui) -ge 3 -and (Get-Score 'dotnet') -gt 0) { $script:scores['dotnet'] = [Math]::Min((Get-Score 'dotnet'), (Get-Score $ui) - 0.5) } }

$ranked = @($script:scores.GetEnumerator() | Where-Object { $_.Value -gt 0 } | Sort-Object @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $i = [array]::IndexOf($script:prio, $_.Key); if ($i -lt 0) { 99 } else { $i } } })
$fw = 'inconnu'; $top = 0
if ($ranked.Count -gt 0) { $fw = $ranked[0].Key; $top = $ranked[0].Value }
$confiance = 'faible'
if ($top -ge 7) { $confiance = 'haute' } elseif ($top -ge 4) { $confiance = 'moyenne' }

$webEngines = @('webview2', 'cef')
$nativeUi = @('wpf', 'winforms', 'winui3', 'uwp', 'qt', 'mfc', 'win32', 'delphi', 'java', 'avalonia', 'maui', 'wx', 'gtk')
$hybride = $null
foreach ($we in $webEngines) {
  if ((Get-Score $we) -ge 4) {
    $nat = @($ranked | Where-Object { $nativeUi -contains $_.Key -and $_.Value -ge 4 } | Select-Object -First 1)
    if ($nat.Count -gt 0) { $hybride = ('{0} + {1} : cadre natif et contenu web' -f $nat[0].Key, $we) }
  }
}

$libelle = $script:labels[$fw]
if ($fw -eq 'qt' -and $qtExtras.Count -gt 0) { $libelle += ' ; ' + (($qtExtras | Select-Object -Unique) -join ', ') }
if ($fw -eq 'java' -and $javaExtras.Count -gt 0) { $libelle += ' ; ' + ($javaExtras -join ', ') }
if (($fw -eq 'wpf' -or $fw -eq 'winforms') -and $dotnet.runtime) { $libelle += ' ; ' + $dotnet.runtime }
if ($paquet) { $libelle += ' ; appli empaquetée MSIX' + $(if ($paquet.bureauEmpaquete) { ' (bureau, FullTrust)' } else { '' }) }

# --- détails Electron
if ($fw -eq 'electron' -or (Get-Score 'electron') -ge 5) {
  $electron = [ordered]@{}
  $verFile = $null
  foreach ($lic in (Find-Rel 'licenses\.chromium\.html')) {
    $vf = Join-Path (Split-Path -Parent $lic.full) 'version'
    if (Test-Path -LiteralPath $vf) { $vt = (Read-TextSafe $vf); if ($vt -and $vt.Trim() -match '^\d+\.\d+\.\d+') { $verFile = $vt.Trim(); break } }
  }
  if ($verFile) { $electron.version = $verFile; $electron.sourceVersion = 'fichier version' }
  elseif ($scan.ContainsKey('electron')) { $electron.version = $scan['electron'].group1; $electron.sourceVersion = 'chaîne Electron/x dans l''exécutable' }
  if ($scan.ContainsKey('chrome')) { $electron.chromium = $scan['chrome'].group1 }
  if ($scan.ContainsKey('fuse')) { $fz = Read-Fuses -File $exe -Offset $scan['fuse'].offset; if ($fz) { $electron.fusibles = $fz } }
  elseif ($NoBinaryScan) { $electron.fusibles = 'non lus (-NoBinaryScan)' }
  elseif ($exe -and $script:onWindows) { $electron.fusibles = 'absents (Electron antérieur à 12, ou exe non parcouru)' }

  $asars = Find-Rel 'resources/app\.asar'
  $appDirs = Find-Rel 'resources/app/package\.json'
  # préférer l'appli située sous le dossier de l'exe (ex. Squirrel : plusieurs app-x.y.z)
  $pick = { param($list) $best = $null; foreach ($x in $list) { if (-not $x.full) { continue }; if ($exeDir -and $x.full.StartsWith($exeDir, [StringComparison]::OrdinalIgnoreCase)) { return $x } ; if (-not $best) { $best = $x } }; return $best }
  $asar = & $pick $asars
  $appPkg = & $pick $appDirs
  $pkgText = $null
  if ($appPkg) {
    $electron.appli = $appPkg.full -replace '[\\/]package\.json$', ''
    $electron.format = 'dossier non archivé'
    $pkgText = Read-TextSafe $appPkg.full
    $appRoot = Split-Path -Parent $appPkg.full
    $html = Get-FolderHtml -Dir $appRoot
    foreach ($h in $html) { if ($ecrans.Count -lt 60) { $ecrans.Add($h) } }
    if ($html.Count -gt 0) { $ecransSource = 'fichiers HTML de l''appli (fenêtres/vues Electron)' }
    $prod = Join-Path $appRoot 'product.json'
    if (Test-Path -LiteralPath $prod) {
      $pj = ConvertFrom-JsonSafe (Read-TextSafe -File $prod -MaxBytes 8MB)
      if ($pj) {
        $po = [ordered]@{}
        foreach ($k in @('nameShort', 'nameLong', 'applicationName', 'dataFolderName', 'win32MutexName')) { $v = Get-Prop $pj $k; if ($v) { $po[$k] = [string]$v } }
        if ($po.Count -gt 0) { $electron.product = $po }
      }
    }
  } elseif ($asar) {
    $electron.appli = $asar.full
    $electron.format = 'archive asar'
    $ah = Read-AsarHeader $asar.full
    if ($ah) {
      $electron.enteteAsarOctets = $ah.headerBytes
      $pkgText = Read-AsarText -Asar $ah -Rel 'package.json'
      $acc = New-Object System.Collections.Generic.List[string]
      $visited = 0
      Get-AsarHtml -Node $ah.header -Prefix '' -Depth 0 -Acc $acc -Visited ([ref]$visited)
      foreach ($h in $acc) { if ($ecrans.Count -lt 60) { $ecrans.Add($h) } }
      if ($acc.Count -gt 0) { $ecransSource = 'fichiers HTML listés dans l''en-tête de app.asar (fenêtres/vues Electron)' }
    } else { $script:warnings.Add('En-tête app.asar illisible.') }
  }
  if ($pkgText) { $ps = Get-PackageSummary $pkgText; if ($ps) { $electron.package = $ps } }
  if ($electron.fusibles -is [System.Collections.IDictionary]) {
    if ($electron.fusibles['EnableNodeCliInspectArguments'] -eq 'desactive') { $script:notes.Add('Fusible EnableNodeCliInspectArguments désactivé : --inspect bloqué ; --remote-debugging-port (option Chromium) n''est en principe pas concerné.') }
  }
}

# ---------------------------------------------------------------------------------------------------------
# 5. Dossiers de données (existence seulement, contenu jamais lu)
# ---------------------------------------------------------------------------------------------------------
$names = New-Object System.Collections.Generic.List[string]
function Add-Name([string]$n) { if ($n) { $n = $n.Trim(); if ($n -and $n.Length -le 80 -and -not $names.Contains($n)) { $names.Add($n) } } }
if ($electron -and $electron.package) { Add-Name $electron.package['productName']; Add-Name $electron.package['name'] }
if ($electron -and $electron.product) { Add-Name $electron.product['nameShort'] }
if ($verInfo) { Add-Name $verInfo['produit'] }
if ($exe) { Add-Name ([IO.Path]::GetFileNameWithoutExtension($exe)) }
Add-Name (Split-Path $root -Leaf)
$company = $null; if ($verInfo) { $company = $verInfo['editeur'] }
$dataDirs = New-Object System.Collections.Generic.List[string]
function Add-DataDir([string]$p) { if ($p -and -not ($dataDirs -contains $p) -and (Test-Path -LiteralPath $p)) { $dataDirs.Add($p) } }   # -contains : insensible à la casse comme Windows
foreach ($n in $names) {
  if ($n -match '^(Microsoft|Windows|Program Files|Programs|Application|bin|app)$') { continue }
  foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA, $env:ProgramData)) { if ($b) { Add-DataDir (Join-Path $b $n) } }
  if ($company) { foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA)) { if ($b) { Add-DataDir (Join-Path (Join-Path $b $company) $n) } } }
}
if ($electron -and $electron.product -and $electron.product['dataFolderName'] -and $env:USERPROFILE) { Add-DataDir (Join-Path $env:USERPROFILE $electron.product['dataFolderName']) }
if ($paquet -and $paquet.familleDePaquet -and $env:LOCALAPPDATA) { Add-DataDir (Join-Path (Join-Path $env:LOCALAPPDATA 'Packages') $paquet.familleDePaquet) }
$regKeys = @()
if ($script:onWindows) {
  foreach ($n in $names) {
    foreach ($k in @(('HKCU:\Software\' + $n), $(if ($company) { 'HKCU:\Software\' + $company + '\' + $n }))) {
      if ($k -and $regKeys -notcontains $k) { try { if (Test-Path -LiteralPath $k) { $regKeys += $k } } catch { } }
    }
  }
}

# ---------------------------------------------------------------------------------------------------------
# 6. Stratégie de capture (skill capture-bureau)
# ---------------------------------------------------------------------------------------------------------
$exeQ = $(if ($exe) { Q $exe } else { "'<chemin de l''exe>'" })
$procName = $(if ($procDetails) { $procDetails.nom } elseif ($exe) { [IO.Path]::GetFileNameWithoutExtension($exe) } else { '<nom du processus>' })
$slug = ($procName.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-'); if (-not $slug) { $slug = 'appli' }
$cdp = 'py "' + (Join-Path $script:outils 'cdp_eval.py') + '"'
# Les commandes de capture visent le PID de l'instance lancée pour la capture (-ProcessId), jamais le nom :
# un -ProcessName pourrait tomber sur une fenêtre ouverte par l'utilisateur.
$pidFind = 'Get-Process -Name "' + $procName + '" -ErrorAction SilentlyContinue | Select-Object Id, StartTime   # AVANT et APRÈS le lancement : le PID apparu est le vôtre (un lanceur renvoie souvent un PID qui disparaît)'
$uiaList = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $script:outils 'uia_dump.ps1') + '" -ProcessId <PID> -ListWindows'
$uia = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $script:outils 'uia_dump.ps1') + '" -ProcessId <PID> -Out "<dossier de capture>\uia-ecran.json"'
$shot = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $script:outils 'window_shot.ps1') + '" -ProcessId <PID> -Out "<dossier de capture>\ecran.png"'
$closeNote = 'Noter le PID affiché et, à la fin, fermer UNIQUEMENT ce processus : Stop-Process -Id <PID>. Ne jamais fermer une instance ouverte par l''utilisateur.'
$pidNote = '<PID> = celui de l''instance lancée pour la capture (skill capture-bureau), retrouvé par différence avant/après le lancement. -ListWindows (lecture seule) confirme ses fenêtres et donne le handle ; un nom de processus pourrait désigner une fenêtre de l''utilisateur.'
$isVsCode = [bool]($exe -and ((Split-Path $exe -Leaf) -match '^(Code|Code - Insiders|VSCodium|Cursor|Windsurf)\.exe$'))
$updateNote = 'Mises à jour automatiques : une appli lancée pour la capture peut télécharger et INSTALLER sa nouvelle version (vu avec VS Code : CodeSetup lancé par le processus, installation de l''utilisateur modifiée). Les bloquer dans le profil temporaire avant le lancement quand l''appli le permet, et ne jamais arrêter un processus *Setup*, Update.exe ou inno_updater en cours : attendre sa fin.'
$closeElectron = 'Fermer : Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ''*cu-' + $slug + '*'' -and $_.Name -notmatch ''setup|update|inno'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }   # seulement NOTRE profil, sans taskkill /T (il tuerait un installeur enfant) ; le processus principal peut rester visible 10 à 20 s ; puis supprimer le profil.'

function New-Strategy([string]$methode, [string[]]$commandes, [string[]]$remarques) {
  return [ordered]@{ skill = 'capture-bureau'; methode = $methode; commandes = @($commandes); remarques = @($remarques) }
}
$strategie = $null
switch ($fw) {
  { $_ -in @('electron', 'nwjs') } {
    $cmdsE = New-Object System.Collections.Generic.List[string]
    $cmdsE.Add($pidFind)
    if ($isVsCode) {
      # VS Code et dérivés : réglages du profil temporaire qui bloquent mise à jour et télémétrie (testé : sans eux,
      # VS Code a installé sa nouvelle version pendant la capture).
      $cmdsE.Add('$d = Join-Path $env:TEMP ''cu-' + $slug + '''; $x = Join-Path $env:TEMP ''cu-' + $slug + '-ext''; New-Item -ItemType Directory -Force -Path (Join-Path $d ''User''), $x | Out-Null; [IO.File]::WriteAllText((Join-Path $d ''User\settings.json''), ''{"update.mode": "none", "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false, "telemetry.telemetryLevel": "off", "workbench.enableExperiments": false}'')   # UTF-8 sans BOM')
      $cmdsE.Add('$p = Start-Process -FilePath ' + $exeQ + ' -ArgumentList ''--remote-debugging-port=9229'', (''--user-data-dir="'' + $d + ''"''), (''--extensions-dir="'' + $x + ''"''), ''--disable-telemetry'', ''--disable-features=CalculateNativeWinOcclusion'', ''--new-window'' -PassThru; $p.Id')
    } else {
      $cmdsE.Add('$d = Join-Path $env:TEMP ''cu-' + $slug + '''; $p = Start-Process -FilePath ' + $exeQ + ' -ArgumentList ''--remote-debugging-port=9229'', (''--user-data-dir="'' + $d + ''"''), ''--disable-features=CalculateNativeWinOcclusion'' -PassThru; $p.Id')
    }
    $cmdsE.Add($cdp + ' --port 9229 --wait-port 20 list')
    $tgt = $(if ($isVsCode) { 'workbench' } else { '<morceau d''URL ou de titre de la fenêtre principale (voir list)>' })
    $cmdsE.Add($cdp + ' --port 9229 eval --target "' + $tgt + '" --file "' + (Join-Path $script:outils 'capture-kit.js') + '" --expr "__config({raw:true}); __info()" --out "<dossier de capture>\info.json"')
    $remE = @(
      'Le profil temporaire (--user-data-dir) donne une appli « neuve » : non connectée, sans les données de l''utilisateur. C''est voulu (lecture seule, vie privée) ; si l''utilisateur veut capturer son état connecté, il se connecte lui-même dans cette instance.',
      $updateNote,
      'Mode raw du kit indispensable avec cdp_eval.py (__config({raw:true})) : sans lui, __dump n''écrit que le nombre de morceaux. Viser la fenêtre principale par un morceau d''URL ou de titre (--target), pas un index qui peut changer.',
      'Si l''appli ignore --user-data-dir et qu''une instance est déjà ouverte, les arguments sont transmis à cette instance et le port ne s''ouvre pas : demander à l''utilisateur de fermer son instance.',
      'Si aucun port ne répond (list vide ou refus), l''appli filtre ses arguments : repli sur UI Automation + captures de fenêtre.',
      $closeElectron)
    if ($isVsCode) { $remE = @('VS Code : la fenêtre « Welcome » est une couche modale (div.onboarding-a-overlay) : la capturer, puis la fermer par sa croix, jamais par un bouton de connexion. Sans --disable-extensions (un dossier d''extensions vide suffit) : cette option ajoute une notification qui n''existe pas dans l''appli normale.') + $remE }
    $strategie = New-Strategy 'CDP (Chrome DevTools Protocol) : relancer l''appli avec un port de débogage sur un profil temporaire, puis la traiter comme une appli web (DOM, styles, captures).' @($cmdsE) $remE
  }
  { $_ -in @('webview2', 'tauri') } {
    $strategie = New-Strategy 'CDP via WebView2 : variables d''environnement WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS (port de débogage) et WEBVIEW2_USER_DATA_FOLDER (profil temporaire), puis cdp_eval.py.' @(
      ('$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = ''--remote-debugging-port=9222''; $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP ''cu-' + $slug + '-wv2''; $p = Start-Process -FilePath ' + $exeQ + ' -PassThru; $p.Id'),
      ($cdp + ' --port 9222 list'),
      $uia
    ) @(
      'Les variables ne valent que pour les processus lancés depuis cette session PowerShell ; si l''appli tourne déjà, l''instance existante ne les voit pas (demander à l''utilisateur de la fermer).',
      'Le cadre de la fenêtre (barre de titre, menus natifs) n''est pas dans le DOM : le capturer avec UI Automation et window_shot.ps1.',
      $closeNote)
  }
  'cef' {
    $strategie = New-Strategy 'CEF : essayer --remote-debugging-port (marche si l''appli transmet ses arguments à CEF), sinon UI Automation + captures.' @(
      ('$p = Start-Process -FilePath ' + $exeQ + ' -ArgumentList ''--remote-debugging-port=9222'' -PassThru; $p.Id'),
      ($cdp + ' --port 9222 list'), $uia, $shot
    ) @('CefSharp (.NET) et beaucoup d''applis CEF n''acceptent pas ce paramètre : ne pas insister, passer aux captures.', $closeNote)
  }
  'qt' {
    $cmds = @()
    $rem = @('Qt expose une accessibilité correcte pour les Qt Widgets (UI Automation via le plugin d''accessibilité), plus partielle pour QML.')
    if (($qtExtras -join ' ') -match 'WebEngine') {
      $cmds += ('$env:QTWEBENGINE_REMOTE_DEBUGGING = ''9223''; $p = Start-Process -FilePath ' + $exeQ + ' -PassThru; $p.Id')
      $cmds += ($cdp + ' --port 9223 list')
      $rem += 'Qt WebEngine : les vues web deviennent inspectables par CDP grâce à QTWEBENGINE_REMOTE_DEBUGGING.'
    }
    $cmds += $uia; $cmds += $shot
    $rem += $closeNote
    $strategie = New-Strategy 'UI Automation (arbre des contrôles) + captures de fenêtre ; CDP pour les vues Qt WebEngine éventuelles.' $cmds $rem
  }
  { $_ -in @('wpf', 'winforms', 'winui3', 'uwp', 'avalonia', 'maui', 'dotnet', 'mfc', 'win32', 'delphi', 'wx') } {
    $q = 'bonne'
    if ($_ -in @('wpf', 'winui3', 'uwp', 'maui')) { $q = 'excellente (XAML expose noms, types, AutomationId)' }
    elseif ($_ -in @('delphi', 'wx', 'avalonia')) { $q = 'variable (contrôles parfois dessinés sans accessibilité)' }
    $launchNote = $(if ($paquet) {
        'Appli du Store (MSIX) : pas de profil temporaire possible, et beaucoup restaurent leur session (Bloc-notes : onglets précédents). La lancer SANS fichier (un fichier ouvert pour l''occasion réapparaîtrait dans la session de l''utilisateur) ; si elle montre des noms de fichiers de l''utilisateur, les remplacer par des noms fictifs dans les notes, ou lui demander de fermer ces onglets. Ne pas ouvrir le sous-menu des fichiers récents.'
      } else {
        'Lancer l''appli soi-même quand c''est possible (sur un fichier ou un dossier de test du dossier de travail, jamais sur les documents de l''utilisateur), noter son PID et ne fermer que celui-là.'
      })
    $strategie = New-Strategy ('UI Automation (uia_dump.ps1) + captures de fenêtre (window_shot.ps1) ; qualité attendue de l''arbre UIA : ' + $q + '.') @($uia, $shot) @(
      'Explorer les menus, onglets et boîtes de dialogue avec prudence (ouvrir puis Échap/Annuler), sans rien enregistrer.',
      $launchNote,
      $closeNote)
  }
  'java' {
    $strategie = New-Strategy 'Captures de fenêtre + exploration prudente ; UI Automation très limité tant que Java Access Bridge n''est pas activé.' @($shot, $uia) @(
      'Activer Java Access Bridge (jabswitch -enable) modifie un réglage du système : ne le faire qu''avec l''accord explicite de l''utilisateur.',
      $closeNote)
  }
  'flutter' {
    $strategie = New-Strategy 'Captures de fenêtre ; UI Automation partiel (arbre sémantique Flutter).' @($shot, $uia) @('Les textes et tailles se mesurent sur les captures : annoncer une fidélité réduite pour les détails.', $closeNote)
  }
  { $_ -in @('unity', 'unreal', 'godot') } {
    $strategie = [ordered]@{ skill = 'copier-une-appli'; methode = 'Moteur de jeu : hors du cœur de cible (rendu GPU, aucun arbre de contrôles). Proposer de recréer seulement des menus à partir de captures d''écran, avec une fidélité réduite.'; commandes = @($shot); remarques = @() }
  }
  'chromium-browser' {
    $strategie = [ordered]@{ skill = 'capture-web'; methode = 'C''est un navigateur : pour copier un site ou une appli web, utiliser le skill capture-web (Chrome/Edge headless sur profil temporaire, ou Claude in Chrome pour une appli connectée).'; commandes = @(); remarques = @('Ne pas lancer chrome.exe sans --headless et --user-data-dir temporaire : sous Windows, il s''ouvrirait dans la session de l''utilisateur.') }
  }
  'gecko' {
    if ($exe -and ((Split-Path $exe -Leaf) -match '^firefox')) {
      $strategie = [ordered]@{ skill = 'capture-web'; methode = 'C''est le navigateur Firefox : pour copier un site ou une appli web, utiliser le skill capture-web.'; commandes = @(); remarques = @() }
    } else {
      $strategie = New-Strategy 'Appli Gecko (Thunderbird...) : UI Automation (accessibilité correcte) + captures de fenêtre ; pas de CDP.' @($uia, $shot) @($closeNote)
    }
  }
  { $_ -in @('tkinter', 'gtk', 'python') } {
    $strategie = New-Strategy 'Captures de fenêtre + UI Automation (accessibilité faible à moyenne).' @($shot, $uia) @($closeNote)
  }
  default {
    $strategie = New-Strategy 'Type non déterminé : essayer UI Automation et une capture de fenêtre pour voir ce qui est exposé.' @($uia, $shot) @('Relancer detect_app.ps1 avec -ProcessName pendant que l''appli est ouverte : les modules chargés lèvent souvent le doute.')
  }
}
if (@($strategie.commandes | Where-Object { $_ -eq $uia -or $_ -eq $shot }).Count -gt 0) {
  # repérage du PID (avant/après le lancement) et liste de ses fenêtres juste avant la première commande UIA /
  # capture, puis la règle du PID
  $cmds2 = New-Object System.Collections.Generic.List[string]
  foreach ($c in @($strategie.commandes)) {
    if (($c -eq $uia -or $c -eq $shot) -and -not $cmds2.Contains($uiaList)) {
      if (-not $cmds2.Contains($pidFind)) { $cmds2.Add($pidFind) }
      $cmds2.Add($uiaList)
    }
    $cmds2.Add($c)
  }
  $strategie.commandes = @($cmds2)
  $strategie.remarques = @($strategie.remarques) + @($pidNote)
}
if ($hybride) { $strategie.remarques = @('Appli hybride (' + $hybride + ') : UI Automation pour le cadre natif, CDP (WebView2/CEF) pour la partie web.') + @($strategie.remarques) }

# ---------------------------------------------------------------------------------------------------------
# 7. Résultat
# ---------------------------------------------------------------------------------------------------------
$nomAppli = $null
if ($electron -and $electron.package -and $electron.package['productName']) { $nomAppli = $electron.package['productName'] }
elseif ($verInfo -and $verInfo['produit']) { $nomAppli = $verInfo['produit'] }
elseif ($paquet) { $nomAppli = $paquet.nom }
elseif ($exe) { $nomAppli = [IO.Path]::GetFileNameWithoutExtension($exe) }

$resume = $script:labels[$fw]
if ($fw -eq 'electron' -and $electron) {
  $resume = 'Electron' + $(if ($electron.version) { ' ' + $electron.version } else { '' }) + $(if ($electron.chromium) { ' (Chromium ' + $electron.chromium + ')' } else { '' })
}
if ($nomAppli) { $resume = $nomAppli + ' : ' + $resume }
$resume += ' ; confiance ' + $confiance + ' ; capture : ' + $strategie.skill

$result = [ordered]@{
  ok          = $true
  resume      = $resume
  framework   = $fw
  libelle     = $libelle
  confiance   = $confiance
  hybride     = $hybride
  candidats   = @($ranked | Select-Object -First 6 | ForEach-Object { [ordered]@{ framework = $_.Key; score = $_.Value } })
  indices     = @($script:hints)
  cible       = [ordered]@{ mode = $(switch ($mode) { 'Name' { 'processus' } 'Id' { 'processus' } default { 'chemin' } }); dossier = $root; exe = $exe; processusEnCours = @($running).Count; pidsEnCours = @($running | Select-Object -First 6 | ForEach-Object { $_.Id }) }
  executable  = [ordered]@{ version = $verInfo; pe = $peInfo }
}
if ($procDetails) { $result.processus = $procDetails }
if ($electron) { $result.electron = $electron }
if ($dotnet.Count -gt 0) { $result.dotnet = $dotnet }
if ($paquet) { $result.paquet = $paquet }
if ($qtExtras.Count -gt 0) { $result.qt = @($qtExtras | Select-Object -Unique) }
if ($javaExtras.Count -gt 0) { $result.java = $javaExtras }
if ($ecrans.Count -gt 0) { $result.ecransPresumes = [ordered]@{ source = $ecransSource; liste = @($ecrans) } }
$result.donnees = [ordered]@{ dossiers = @($dataDirs); registre = @($regKeys); note = 'Existence seulement : ne pas lire ni copier ces emplacements (sessions, jetons, données personnelles).' }
$result.strategie = $strategie
$result.notes = @($script:notes)
$result.avertissements = @($script:warnings)
$result.dureeSecondes = [Math]::Round($script:started.Elapsed.TotalSeconds, 1)

Out-Result $result 0
