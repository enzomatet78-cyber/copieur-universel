#Requires -Version 5.1
<#
.SYNOPSIS
  Lance ou ferme un Chrome/Edge headless sur un profil TEMPORAIRE (plugin copieur-universel : capture de sites
  publics, mesures du clone, reconnaissance).

.DESCRIPTION
  -Action lancer : crée un profil neuf %TEMP%\cu-<navigateur>-xxxxxxxx, choisit un port libre (ou -Port),
  lance le navigateur en --headless=new avec ce profil, attend que le port de débogage réponde, puis règle
  le viewport avec cdp_eval.py « size » (-Viewport, 1536x791 par défaut). Sortie : une ligne JSON
  {ok, navigateur, port, pid, profil, viewport} — noter port et profil pour la fermeture.
  Le profil temporaire est indispensable : sans lui, Windows confierait la commande au navigateur déjà ouvert
  de l'utilisateur (ses onglets, ses sessions) et le port de débogage ne s'ouvrirait pas.

  -Action fermer -Profil <dossier> [-Port N] : quitte proprement le navigateur (Browser.close par
  cdp_eval.py si -Port est donné), arrête en boucle les processus dont la ligne de commande contient CE
  dossier de profil (jamais les autres : le navigateur de l'utilisateur n'a pas ce dossier), ignore ceux
  déjà terminés, puis supprime le profil (jusqu'à 60 s : les processus enfants le gardent verrouillé
  quelques secondes ; chemins longs gérés). Sortie JSON {ok, restants, profilSupprime, message}.

  -Action etat -Profil <dossier> : processus encore vivants pour ce profil.

  Garde-fou : -Profil doit être un dossier « cu-* » directement sous %TEMP% (rien d'autre n'est supprimé).
  Messages en UTF-8. Code de sortie 0 = fait, 1 = erreur ou nettoyage incomplet (le message dit quoi faire).

  Pourquoi un script plutôt que des lignes PowerShell à recopier : elles finissaient avec un exécutable codé
  en dur (chrome.exe alors qu'on avait lancé Edge), des accents illisibles (fichier sans BOM), et l'outil
  PowerShell de Claude Code bloque « Remove-Item » sur un chemin contenu dans une variable. Lancé avec -File,
  ce script n'a aucun de ces problèmes.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File headless.ps1 -Action lancer
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File headless.ps1 -Action lancer -Navigateur edge -Viewport 1204x804 -Echelle 1.25
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File headless.ps1 -Action fermer -Profil "C:\Users\moi\AppData\Local\Temp\cu-chrome-1a2b3c4d" -Port 9333
#>
[CmdletBinding()]
param(
  [ValidateSet('lancer', 'fermer', 'etat')]
  [string]$Action = 'lancer',
  [ValidateSet('chrome', 'edge')]
  [string]$Navigateur = 'chrome',
  [int]$Port = 0,
  [string]$Profil,
  [string]$Viewport = '1536x791',
  [double]$Echelle = 0,
  [string]$Langue = '',
  [int]$AttenteSecondes = 60
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

function Write-Utf8([string]$Text, [switch]$Err) {
  $redirected = $(if ($Err) { [Console]::IsErrorRedirected } else { [Console]::IsOutputRedirected })
  if ($redirected) {
    $s = $(if ($Err) { [Console]::OpenStandardError() } else { [Console]::OpenStandardOutput() })
    $b = [Text.Encoding]::UTF8.GetBytes($Text + "`n")
    $s.Write($b, 0, $b.Length); $s.Flush()
  } elseif ($Err) { [Console]::Error.WriteLine($Text) } else { [Console]::Out.WriteLine($Text) }
}
function Out-Json($o) { Write-Utf8 ($o | ConvertTo-Json -Compress -Depth 4) }
function Fail([string]$Msg) { Out-Json ([ordered]@{ ok = $false; erreur = $Msg }); exit 1 }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Fail 'headless.ps1 est propre à Windows. Ailleurs (macOS, Linux) : python3 headless.py lancer, dans le même dossier outils (mêmes actions lancer, etat, fermer ; plus trouver).'
}

$outils = $PSScriptRoot
$cdp = Join-Path $outils 'cdp_eval.py'
$temp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')

function Find-Exe([string]$nav) {
  $c = $(if ($nav -eq 'edge') {
      @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")
    } else {
      @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
    })
  foreach ($p in $c) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}

function Test-Profil([string]$p) {
  if (-not $p) { Fail 'précisez -Profil <dossier noté au lancement> (un dossier cu-* de %TEMP%).' }
  $full = [IO.Path]::GetFullPath($p).TrimEnd('\')
  $parent = [IO.Path]::GetDirectoryName($full)
  $nom = [IO.Path]::GetFileName($full)
  if ($parent -ne $temp -or $nom -notmatch '^cu-[A-Za-z0-9_.-]+$') {
    Fail ('profil refusé : seul un dossier « cu-* » placé directement dans ' + $temp + ' peut être fermé et supprimé par cet outil.')
  }
  return $full
}

function Get-Miens([string]$full) {
  $res = @()
  foreach ($n in @('chrome.exe', 'msedge.exe')) {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='$n'" -ErrorAction SilentlyContinue)
    foreach ($pr in $procs) {
      if ($pr.CommandLine -and $pr.CommandLine.IndexOf($full, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $v = Get-Process -Id $pr.ProcessId -ErrorAction SilentlyContinue
        if ($v -and -not $v.HasExited) { $res += $pr }
      }
    }
  }
  return ,$res
}

function Remove-Profil([string]$full) {
  if (-not (Test-Path -LiteralPath $full)) { return $true }
  try { [IO.Directory]::Delete('\\?\' + $full, $true) } catch { }
  return -not (Test-Path -LiteralPath $full)
}

function Free-Port {
  $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); return $p
}

function Test-PortUsed([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $ar = $c.BeginConnect('127.0.0.1', $p, $null, $null); $ok = $ar.AsyncWaitHandle.WaitOne(400); if ($ok) { $c.EndConnect($ar) }; return ($ok -and $c.Connected) }
  catch { return $false } finally { $c.Close() }
}

function Invoke-Py([string[]]$a) {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $py) { return @{ code = 127; texte = 'Python introuvable (py ou python)' } }
  # Windows PowerShell 5.1 : avec ErrorActionPreference = Stop, la moindre ligne sur stderr d'un programme
  # (un simple avertissement) deviendrait une erreur qui arrête le script.
  # cdp_eval.py écrit en UTF-8 quand sa sortie est redirigée : la lire en UTF-8 (sinon accents illisibles).
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $enc = $null; try { $enc = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
  try { $o = & $py.Source @a 2>&1 | ForEach-Object { "$_" } | Out-String; $rc = $LASTEXITCODE }
  finally { $ErrorActionPreference = $old; if ($enc) { try { [Console]::OutputEncoding = $enc } catch { } } }
  return @{ code = $rc; texte = $o.Trim() }
}

switch ($Action) {
  'lancer' {
    $exe = Find-Exe $Navigateur
    if (-not $exe) { Fail ("$Navigateur introuvable aux emplacements habituels ; essayez -Navigateur " + $(if ($Navigateur -eq 'edge') { 'chrome' } else { 'edge' })) }
    if ($Port -eq 0) { $Port = Free-Port }
    elseif ($Port -lt 1024 -or $Port -gt 65535) { Fail "port $Port refusé : choisir entre 1024 et 65535 (habitude du plugin : 9333), ou -Port 0 pour un port libre." }
    elseif (Test-PortUsed $Port) { Fail "le port $Port est déjà occupé (autre navigateur, autre capture ?) : prenez-en un autre, ou -Port 0 pour un port libre." }
    if ($Viewport -notmatch '^(\d+)x(\d+)$') { Fail '-Viewport attendu sous la forme LARGEURxHAUTEUR, ex. 1536x791' }
    $vw = [int]$Matches[1]; $vh = [int]$Matches[2]
    $court = $(if ($Navigateur -eq 'edge') { 'edge' } else { 'chrome' })
    $prof = Join-Path $temp ('cu-' + $court + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $prof | Out-Null
    # Fenêtre un peu plus grande que le viewport (la fenêtre headless retire une marge), corrigée ensuite par « size ».
    $lancement = @('--headless=new', "--remote-debugging-port=$Port", "--user-data-dir=`"$prof`"",
      ('--window-size={0},{1}' -f ([Math]::Max(520, $vw + 18)), ($vh + 96)),
      '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen')
    if ($Echelle -gt 0) { $lancement += ('--force-device-scale-factor=' + $Echelle.ToString([Globalization.CultureInfo]::InvariantCulture)) }
    if ($Langue) { $lancement += "--lang=$Langue" }
    $lancement += 'about:blank'
    $p = Start-Process -FilePath $exe -ArgumentList $lancement -PassThru
    $r = Invoke-Py @($cdp, '--port', "$Port", '--wait-port', '20', 'size', '--viewport', $Viewport)
    $obtenu = $(if ($r.texte -match 'viewport (\d+x\d+)') { $Matches[1] } else { '' })
    # ok = le navigateur répond ; un viewport différent de celui demandé (petit écran < 500 px, écart d'1 px à
    # l'échelle 1,25) n'est qu'un avertissement : --viewport sur nav/eval/shot donne alors la taille exacte.
    $o = [ordered]@{ ok = [bool]$obtenu; navigateur = $court; exe = $exe; port = $Port; pid = $p.Id; profil = $prof
      viewport = $obtenu; message = $(if ($r.code -eq 0) { 'prêt : cdp_eval.py --port ' + $Port + ' list' } else { $r.texte }) }
    if ($obtenu -and $obtenu -ne $Viewport) { $o.avertissement = "viewport $obtenu au lieu de $Viewport : ajouter --viewport $Viewport à nav, eval, shot et hover" }
    Out-Json $o
    if (-not $obtenu) { exit 1 }
    exit 0
  }
  'etat' {
    $full = Test-Profil $Profil
    $m = Get-Miens $full
    Out-Json ([ordered]@{ ok = $true; profil = $full; existe = (Test-Path -LiteralPath $full); processus = @($m | ForEach-Object { [ordered]@{ pid = $_.ProcessId; nom = $_.Name } }) })
    exit 0
  }
  'fermer' {
    $full = Test-Profil $Profil
    $notes = @()
    if ($Port -gt 0) {
      $r = Invoke-Py @($cdp, '--port', "$Port", 'close', '--browser')
      $notes += ('Browser.close : ' + $(if ($r.code -eq 0) { 'ok' } else { 'sans effet (' + ($r.texte -split "`n")[0] + ')' }))
    }
    $t0 = Get-Date
    while (((Get-Date) - $t0).TotalSeconds -lt 20) {
      $m = Get-Miens $full
      if ($m.Count -eq 0) { break }
      foreach ($pr in $m) { Stop-Process -Id $pr.ProcessId -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Milliseconds 700
    }
    $rest = (Get-Miens $full).Count
    $suppr = $false
    if ($rest -eq 0) {
      while (((Get-Date) - $t0).TotalSeconds -lt $AttenteSecondes) {
        if (Remove-Profil $full) { $suppr = $true; break }
        Start-Sleep -Seconds 2
      }
    }
    $msg = $(if ($rest -gt 0) { "$rest processus encore vivants pour ce profil : relancer -Action fermer dans quelques secondes" }
      elseif (-not $suppr) { "processus arrêtés, mais le profil est encore verrouillé : relancer -Action fermer plus tard, ou le signaler (chemin : $full)" }
      else { 'navigateur arrêté, profil supprimé' })
    Out-Json ([ordered]@{ ok = ($rest -eq 0 -and $suppr); restants = $rest; profilSupprime = $suppr; profil = $full; message = $msg; notes = $notes; secondes = [Math]::Round(((Get-Date) - $t0).TotalSeconds, 1) })
    if ($rest -eq 0 -and $suppr) { exit 0 } else { exit 1 }
  }
}
