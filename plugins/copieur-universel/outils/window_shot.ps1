#Requires -Version 5.1
<#
.SYNOPSIS
  Capture PNG d'une fenêtre Windows, même en arrière-plan (plugin copieur-universel, skill capture-bureau).

.DESCRIPTION
  Méthodes :
    PrintWindow (défaut)  demande à la fenêtre de se dessiner dans une image (PW_RENDERFULLCONTENT) : marche
                          même si la fenêtre est derrière d'autres, sans la déplacer ni l'activer ;
    Screen                copie la zone de l'écran (BitBlt avec CAPTUREBLT) : seulement si AUCUNE autre fenêtre ne
                          recouvre la cible (sinon l'image contiendrait le contenu d'une autre appli de
                          l'utilisateur) - vérifié avant la capture, sauf -Force ;
    Auto                  PrintWindow, puis Screen si l'image est vide/uniforme (certaines applis GPU), ou si la
                          fenêtre contient des îlots WinUI/XAML et qu'elle est dégagée ; PrintWindow est gardé
                          quand une partie passe sous la barre des tâches (l'écran la rendrait transparente).

  L'image est recadrée sur le cadre VISIBLE de la fenêtre (DWM, sans les bordures invisibles de Windows 10/11) :
  ses pixels ont la même origine que les rectangles de uia_dump.ps1. Pixels physiques : diviser par
  « echelle » (DPI/96) pour des px CSS. Le script se déclare « DPI aware » (SetProcessDpiAwarenessContext,
  repli SetProcessDPIAware).

  -Activate met la fenêtre au premier plan le temps de la capture (attente -DelayMs, 1500 ms par défaut, pour
  qu'elle se redessine), puis rend le premier plan à la fenêtre précédente.

  -IncludePopups ajoute les fenêtres surgissantes du même processus (menus ouverts, listes déroulantes,
  infobulles, flyouts WinUI) composées au-dessus de la fenêtre ; le reste de l'image est transparent. La marge
  d'ombre d'un menu (noire avec PrintWindow, et qui laisse voir les fenêtres de DERRIÈRE à l'écran) est
  retirée. Si un menu déborde à gauche ou en haut de la fenêtre, l'image commence avant son cadre : la réponse
  donne « decalage » {x, y} = position du cadre de la fenêtre dans l'image, à ajouter aux rectangles UIA.

  Windows uniquement. Aucune donnée n'est masquée : anonymiser AVANT la capture (document fictif, profil
  temporaire), puis regarder l'image. Viser le PID de l'instance lancée pour la capture : -ProcessName ou un
  titre seul pourraient tomber sur une fenêtre de l'utilisateur.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File window_shot.ps1 -ProcessId 1234 -Out C:\travail\fenetre.png
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File window_shot.ps1 -ProcessId 1234 -IncludePopups -Out C:\travail\menu-fichier.png
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File window_shot.ps1 -ProcessId 1234 -WindowTitle "Mise en page" -Out C:\travail\dialogue.png
#>
[CmdletBinding()]
param(
  [string]$ProcessName,
  [string]$WindowTitle,
  [string]$Handle,
  [int]$ProcessId,
  [string]$Out,
  [ValidateSet('Auto', 'PrintWindow', 'Screen')]
  [string]$Method = 'Auto',
  [switch]$IncludePopups,
  [switch]$NoCrop,
  [switch]$Restore,
  [switch]$Activate,
  [switch]$Force,
  [int]$DelayMs = 1500
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script:Version = '1.1'

function Write-Utf8([string]$Text, [switch]$Err) {
  $redirected = $(if ($Err) { [Console]::IsErrorRedirected } else { [Console]::IsOutputRedirected })
  if ($redirected) {
    $s = $(if ($Err) { [Console]::OpenStandardError() } else { [Console]::OpenStandardOutput() })
    $b = [Text.Encoding]::UTF8.GetBytes($Text + "`n")
    $s.Write($b, 0, $b.Length); $s.Flush()
  } elseif ($Err) { [Console]::Error.WriteLine($Text) } else { [Console]::Out.WriteLine($Text) }
}
function Fail([string]$Msg, [int]$Code = 1) { Write-Utf8 ('erreur : ' + $Msg) -Err; exit $Code }
function Warn([string]$Msg) { Write-Utf8 ('attention : ' + $Msg) -Err }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Fail 'window_shot.ps1 ne fonctionne que sous Windows. Sous macOS : screencapture -l <id de fenêtre> ; sous Linux : import -window <id> (ImageMagick).'
}
if (-not $Out) { Fail 'précisez -Out <fichier.png>.' }

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace CopieurUniversel.Shot1
{
    public static class Native
    {
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        public delegate bool EnumProc(IntPtr h, IntPtr l);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int InternalGetWindowText(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
        [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr h, int attr, out int v, int size);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr mon, int type, out uint x, out uint y);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr c);
        [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
        [DllImport("gdi32.dll", SetLastError = true)] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    }

    public static class Json
    {
        public static string Q(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
        public static string N(double d) { return d.ToString("0.###", CultureInfo.InvariantCulture); }
        public static string Rect(int x, int y, int w, int h) { return "{\"x\": " + x + ", \"y\": " + y + ", \"w\": " + w + ", \"h\": " + h + "}"; }
    }

    public class Win
    {
        public IntPtr Handle; public int Pid; public int AppPid; public string Process = ""; public string AppProcess = "";
        public string Title = ""; public string ClassName = ""; public bool Visible; public bool Minimized; public bool Cloaked;
        public IntPtr Owner; public int Left, Top, Width, Height; public int Style, ExStyle; public int Z; public int Dpi; public int MonitorDpi;

        public bool HasCaption { get { return (Style & 0x00C00000) == 0x00C00000; } }
        public bool IsPopup { get { return (Style & unchecked((int)0x80000000)) != 0 && !HasCaption; } }
        public bool IsToolWindow { get { return (ExStyle & 0x80) != 0; } }
        public bool IsTransparent { get { return (ExStyle & 0x20) != 0; } }
        public string Hex { get { return "0x" + Handle.ToInt64().ToString("X"); } }
        // Échelle pour convertir en px CSS : celle de l'ÉCRAN (une appli non DPI-aware renvoie 96 mais Windows
        // l'agrandit quand même à l'échelle de l'écran).
        public double Scale { get { return MonitorDpi > 0 ? MonitorDpi / 96.0 : (Dpi > 0 ? Dpi / 96.0 : 1.0); } }
        public bool StretchedByWindows { get { return Dpi == 96 && MonitorDpi > 96; } }
        public Rectangle Frame { get { return new Rectangle(Left, Top, Width, Height); } }

        static Dictionary<int, string> names = new Dictionary<int, string>();
        public static string ProcName(int pid)
        {
            string n;
            if (names.TryGetValue(pid, out n)) return n;
            try { n = System.Diagnostics.Process.GetProcessById(pid).ProcessName; } catch (Exception) { n = ""; }
            names[pid] = n;
            return n;
        }

        public static string EnsureDpiAwareness()
        {
            try { if (Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per-monitor-v2"; } catch (Exception) { }
            try
            {
                int a = Native.GetAwarenessFromDpiAwarenessContext(Native.GetThreadDpiAwarenessContext());
                if (a == 2) return "per-monitor";
                if (a == 1) return "system";
            }
            catch (Exception) { }
            try { if (Native.SetProcessDPIAware()) return "system"; } catch (Exception) { }
            return "unaware";
        }

        public static Win Describe(IntPtr h, int z)
        {
            var w = new Win();
            w.Handle = h; w.Z = z;
            uint pid; Native.GetWindowThreadProcessId(h, out pid);
            w.Pid = (int)pid; w.Process = ProcName(w.Pid);
            var sb = new StringBuilder(1024); Native.InternalGetWindowText(h, sb, sb.Capacity); w.Title = sb.ToString();
            var cb = new StringBuilder(256); Native.GetClassName(h, cb, 256); w.ClassName = cb.ToString();
            w.Visible = Native.IsWindowVisible(h);
            w.Minimized = Native.IsIconic(h);
            int cl = 0;
            try { w.Cloaked = Native.DwmGetWindowAttributeInt(h, 14, out cl, 4) == 0 && cl != 0; } catch (Exception) { }
            w.Owner = Native.GetWindow(h, 4);
            w.Style = Native.GetWindowLong(h, -16);
            w.ExStyle = Native.GetWindowLong(h, -20);
            Native.RECT r;
            bool ok = false;
            try { ok = Native.DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(Native.RECT))) == 0 && r.Right > r.Left; } catch (Exception) { r = new Native.RECT(); }
            if (!ok) Native.GetWindowRect(h, out r);
            w.Left = r.Left; w.Top = r.Top; w.Width = r.Right - r.Left; w.Height = r.Bottom - r.Top;
            try { w.Dpi = (int)Native.GetDpiForWindow(h); } catch (Exception) { w.Dpi = 0; }
            try { uint dx, dy; if (Native.GetDpiForMonitor(Native.MonitorFromWindow(h, 2), 0, out dx, out dy) == 0) w.MonitorDpi = (int)dx; } catch (Exception) { w.MonitorDpi = 0; }
            if (w.ClassName == "ApplicationFrameWindow")
            {
                int framePid = w.Pid, found = 0;
                Native.EnumChildWindows(h, delegate(IntPtr c, IntPtr l)
                {
                    uint p; Native.GetWindowThreadProcessId(c, out p);
                    if ((int)p != framePid) { found = (int)p; return false; }
                    return true;
                }, IntPtr.Zero);
                if (found != 0) { w.AppPid = found; w.AppProcess = ProcName(found); }
            }
            return w;
        }

        public static List<Win> TopWindows(bool visibleOnly)
        {
            var list = new List<Win>();
            int z = 0;
            Native.EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                int zz = z++;
                if (!visibleOnly || Native.IsWindowVisible(h)) list.Add(Describe(h, zz));
                return true;
            }, IntPtr.Zero);
            return list;
        }
    }

    public static class Capture
    {
        // PrintWindow(PW_RENDERFULLCONTENT = 2) dans une image 24 bits (le canal alpha renvoyé par certaines
        // applis DirectComposition rendrait l'image transparente), puis recadrage sur le cadre visible.
        public static Bitmap Print(Win w, bool crop, out string err)
        {
            err = null;
            Native.RECT wr;
            if (!Native.GetWindowRect(w.Handle, out wr)) { err = "GetWindowRect a \u00e9chou\u00e9"; return null; }
            int ww = wr.Right - wr.Left, hh = wr.Bottom - wr.Top;
            if (ww <= 0 || hh <= 0) { err = "fen\u00eatre de taille nulle"; return null; }
            // Appli non DPI-aware : PrintWindow la dessine \u00e0 sa taille LOGIQUE ; on l'agrandit ensuite comme
            // Windows le fait \u00e0 l'\u00e9cran, pour rester en pixels physiques (m\u00eames coordonn\u00e9es que uia_dump).
            double f = (w.StretchedByWindows && w.Dpi > 0) ? (double)w.MonitorDpi / w.Dpi : 1.0;
            int lw = f > 1.0 ? (int)Math.Round(ww / f) : ww, lh = f > 1.0 ? (int)Math.Round(hh / f) : hh;
            var full = new Bitmap(lw, lh, PixelFormat.Format24bppRgb);
            bool ok;
            using (var g = Graphics.FromImage(full))
            {
                IntPtr hdc = g.GetHdc();
                try { ok = Native.PrintWindow(w.Handle, hdc, 2); } finally { g.ReleaseHdc(hdc); }
            }
            if (!ok) { full.Dispose(); err = "PrintWindow a \u00e9chou\u00e9"; return null; }
            if (f > 1.0)
            {
                var big = new Bitmap(ww, hh, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(big))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    g.DrawImage(full, new Rectangle(0, 0, ww, hh));
                }
                full.Dispose();
                full = big;
            }
            if (!crop) return full;
            var r = new Rectangle(w.Left - wr.Left, w.Top - wr.Top, w.Width, w.Height);
            r.Intersect(new Rectangle(0, 0, ww, hh));
            if (r.Width <= 0 || r.Height <= 0 || (r.Width == ww && r.Height == hh)) return full;
            var c = full.Clone(r, PixelFormat.Format24bppRgb);
            full.Dispose();
            return c;
        }

        public static Rectangle WindowRect(Win w)
        {
            Native.RECT wr; Native.GetWindowRect(w.Handle, out wr);
            return new Rectangle(wr.Left, wr.Top, wr.Right - wr.Left, wr.Bottom - wr.Top);
        }

        public static Bitmap Screen(Rectangle r)
        {
            // BitBlt SRCCOPY | CAPTUREBLT : inclut les fenêtres « layered » (menus, infobulles) ; Graphics.CopyFromScreen
            // refuse cette combinaison de drapeaux.
            var b = new Bitmap(r.Width, r.Height, PixelFormat.Format24bppRgb);
            IntPtr sdc = Native.GetDC(IntPtr.Zero);
            if (sdc == IntPtr.Zero) throw new InvalidOperationException("GetDC(NULL) : contexte de l'ecran indisponible");
            try
            {
                using (var g = Graphics.FromImage(b))
                {
                    IntPtr hdc = g.GetHdc();
                    try { if (!Native.BitBlt(hdc, 0, 0, r.Width, r.Height, sdc, r.X, r.Y, 0x00CC0020u | 0x40000000u)) throw new System.ComponentModel.Win32Exception(); }
                    finally { g.ReleaseHdc(hdc); }
                }
            }
            finally { Native.ReleaseDC(IntPtr.Zero, sdc); }
            return b;
        }

        public static bool Uniform(Bitmap b)
        {
            if (b == null || b.Width < 2 || b.Height < 2) return true;
            int c0 = b.GetPixel(b.Width / 2, b.Height / 2).ToArgb();
            for (int i = 0; i < 16; i++)
                for (int j = 0; j < 16; j++)
                {
                    int x = (int)((i + 0.5) * b.Width / 16), y = (int)((j + 0.5) * b.Height / 16);
                    if (b.GetPixel(x, y).ToArgb() != c0) return false;
                }
            return true;
        }

        // Marge d'ombre d'une fenêtre surgissante (menu WinUI : ~7 px autour du menu) : PrintWindow la rend en
        // NOIR, une capture d'écran y montre ce qui se trouve DERRIÈRE (fenêtres de l'utilisateur). Renvoie le
        // rectangle du contenu, bords noirs ou transparents retirés (24 px au plus par côté).
        public static Rectangle ContentBox(Bitmap b)
        {
            int w = b.Width, h = b.Height, l = 0, t = 0, r = w - 1, bo = h - 1, max = 24;
            Func<Color, bool> vide = c => c.A == 0 || (c.R < 4 && c.G < 4 && c.B < 4);
            Func<int, bool> col = x => { for (int y = 0; y < h; y += 2) if (!vide(b.GetPixel(x, y))) return false; return true; };
            Func<int, bool> row = y => { for (int x = 0; x < w; x += 2) if (!vide(b.GetPixel(x, y))) return false; return true; };
            while (l < max && l < r && col(l)) l++;
            while (w - 1 - r < max && r > l && col(r)) r--;
            while (t < max && t < bo && row(t)) t++;
            while (h - 1 - bo < max && bo > t && row(bo)) bo--;
            return new Rectangle(l, t, r - l + 1, bo - t + 1);
        }

        // Fenêtres placées au-dessus de la cible et qui recouvrent la zone : celles d'AUTRES processus, et les autres
        // fenêtres principales du même processus (Bloc-notes de Windows 11 : toutes ses fenêtres dans un seul
        // processus, dont peut-être celles de l'utilisateur). Les menus, listes et boîtes possédées de l'appli passent.
        public static List<Win> Occluders(List<Win> zOrder, Win lowest, int[] okPids, Rectangle[] areas)
        {
            var res = new List<Win>();
            foreach (var w in zOrder)
            {
                if (w.Handle == lowest.Handle) break;
                if (Array.IndexOf(okPids, w.Pid) >= 0 && (w.Owner != IntPtr.Zero || w.IsPopup || w.IsToolWindow || w.Title.Length == 0)) continue;
                if (!w.Visible || w.Minimized || w.Cloaked || w.Width <= 0 || w.Height <= 0 || w.IsTransparent) continue;
                var r = w.Frame;
                foreach (var a in areas) { if (r.IntersectsWith(a)) { res.Add(w); break; } }
            }
            return res;
        }

        public static Bitmap Compose(List<Bitmap> layers, List<Rectangle> rects, Rectangle union)
        {
            var canvas = new Bitmap(union.Width, union.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(canvas))
            {
                g.Clear(Color.Transparent);
                g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                for (int i = 0; i < layers.Count; i++)
                    g.DrawImage(layers[i], new Rectangle(rects[i].X - union.X, rects[i].Y - union.Y, rects[i].Width, rects[i].Height));
            }
            return canvas;
        }

        // Îlots de composition (WinUI 3, XAML Islands, UWP) : PrintWindow les rend souvent VIDES.
        public static string CompositionHosts(IntPtr h)
        {
            var found = new List<string>();
            Native.EnumChildWindows(h, delegate(IntPtr c, IntPtr l)
            {
                var cb = new StringBuilder(256); Native.GetClassName(c, cb, 256); string cn = cb.ToString();
                if ((cn.IndexOf("DesktopChildSiteBridge") >= 0 || cn.IndexOf("DesktopWindowContentBridge") >= 0 ||
                     cn.IndexOf("DesktopWindowXamlSource") >= 0 || cn == "Windows.UI.Core.CoreWindow") && !found.Contains(cn)) found.Add(cn);
                return true;
            }, IntPtr.Zero);
            return string.Join(", ", found.ToArray());
        }

        // Premier plan fiable : Windows refuse SetForegroundWindow à un processus d'arrière-plan, sauf si l'on
        // attache temporairement sa file d'entrée à celle de la fenêtre active.
        public static bool Activate(IntPtr h)
        {
            IntPtr fg = Native.GetForegroundWindow();
            if (fg == h) return true;
            uint pid; uint fgThread = fg == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(fg, out pid);
            uint me = Native.GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != me && Native.AttachThreadInput(me, fgThread, true);
            try { Native.BringWindowToTop(h); Native.SetForegroundWindow(h); }
            finally { if (attached) Native.AttachThreadInput(me, fgThread, false); }
            return Native.GetForegroundWindow() == h;
        }

        // Rend transparentes les zones couvertes (barre des tâches) d'une image prise à l'écran.
        public static Bitmap ClearAreas(Bitmap src, Rectangle origin, Rectangle[] clears)
        {
            var dst = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(dst))
            {
                g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height));
                using (var br = new SolidBrush(Color.Transparent))
                    foreach (var c in clears)
                    {
                        var r = Rectangle.Intersect(new Rectangle(c.X - origin.X, c.Y - origin.Y, c.Width, c.Height), new Rectangle(0, 0, src.Width, src.Height));
                        if (r.Width > 0 && r.Height > 0) g.FillRectangle(br, r);
                    }
            }
            return dst;
        }

        public static Bitmap Crop(Bitmap src, Rectangle area, Rectangle origin)
        {
            var r = new Rectangle(area.X - origin.X, area.Y - origin.Y, area.Width, area.Height);
            r.Intersect(new Rectangle(0, 0, src.Width, src.Height));
            return src.Clone(r, PixelFormat.Format24bppRgb);
        }
    }
}
'@

function Import-Core([string]$Source, [string]$TypeName, [string]$Name, [string[]]$Refs) {
  if ($TypeName -as [type]) { return }
  $sha = [Security.Cryptography.SHA256]::Create()
  $bytes = [Text.Encoding]::UTF8.GetBytes($Source + '|' + ($Refs -join '|') + '|' + [Environment]::Version)
  $hash = -join ($sha.ComputeHash($bytes)[0..7] | ForEach-Object { $_.ToString('x2') })
  $dir = Join-Path ([IO.Path]::GetTempPath()) 'copieur-universel'
  $dll = Join-Path $dir ($Name + '-' + $hash + '.dll')
  if (Test-Path -LiteralPath $dll) {
    try { Add-Type -Path $dll; if ($TypeName -as [type]) { return } } catch { }
  }
  try {
    [void](New-Item -ItemType Directory -Force -Path $dir)
    $tmp = Join-Path $dir ($Name + '-' + $hash + '-' + [Guid]::NewGuid().ToString('N') + '.dll')
    Add-Type -TypeDefinition $Source -ReferencedAssemblies $Refs -Language CSharp -OutputAssembly $tmp -OutputType Library
    if (-not ($TypeName -as [type])) {
      try { Move-Item -LiteralPath $tmp -Destination $dll -ErrorAction Stop; $tmp = $dll } catch { }
      Add-Type -Path $tmp
    }
  } catch { }
  if (-not ($TypeName -as [type])) { Add-Type -TypeDefinition $Source -ReferencedAssemblies $Refs -Language CSharp }
}

try {
  Add-Type -AssemblyName System.Drawing
  Import-Core $cs 'CopieurUniversel.Shot1.Capture' 'window_shot' @([System.Drawing.Bitmap].Assembly.Location)
} catch {
  Fail ('chargement impossible : ' + $_.Exception.Message)
}
$dpiMode = [CopieurUniversel.Shot1.Win]::EnsureDpiAwareness()

# ---------------------------------------------------------------------------------------------------------
# Choix de la fenêtre (mêmes règles que uia_dump.ps1)
# ---------------------------------------------------------------------------------------------------------
$pn = $(if ($ProcessName) { $ProcessName -replace '\.exe$', '' } else { '' })
function Test-Win($w) {
  if ($ProcessId -and $w.Pid -ne $ProcessId -and $w.AppPid -ne $ProcessId) { return $false }
  if ($pn -and $w.Process -ne $pn -and $w.AppProcess -ne $pn) { return $false }
  if ($WindowTitle) {
    if ($WindowTitle -match '[\*\?\[]') { if ($w.Title -notlike $WindowTitle) { return $false } }
    elseif ($w.Title.IndexOf($WindowTitle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  }
  return $true
}

$all = [CopieurUniversel.Shot1.Win]::TopWindows($true)
$target = $null
if ($Handle) {
  $h = [IntPtr]::Zero
  $hs = $Handle.Trim()
  if ($hs -match '^0x[0-9a-fA-F]+$') { $h = [IntPtr][Convert]::ToInt64($hs.Substring(2), 16) }
  elseif ($hs -match '^\d+$') { $h = [IntPtr][Int64]$hs }
  else { Fail "handle invalide : $Handle (décimal ou 0x…)" }
  if (-not [CopieurUniversel.Shot1.Native]::IsWindow($h)) { Fail "aucune fenêtre avec le handle $Handle" }
  $target = @($all | Where-Object { $_.Handle -eq $h })[0]
  if (-not $target) { $target = [CopieurUniversel.Shot1.Win]::Describe($h, [int]::MaxValue) }
} else {
  if (-not ($pn -or $ProcessId -or $WindowTitle)) { Fail 'précisez -ProcessName, -ProcessId, -WindowTitle ou -Handle.' }
  $cands = @($all | Where-Object { -not $_.Cloaked -and $_.Width -gt 0 -and $_.Height -gt 0 -and (Test-Win $_) })
  if ($cands.Count -eq 0) {
    $hint = ''
    if ($pn -and (Get-Process -Name $pn -ErrorAction SilentlyContinue)) { $hint = " Le processus « $pn » existe mais n'a aucune fenêtre visible." }
    if ($ProcessId) {
      $pp = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if (-not $pp) { $hint += " Aucun processus avec le PID $ProcessId : il s'est terminé (lanceur ?) ; retrouver le vrai processus." }
      else { $hint += " Le processus $ProcessId ($($pp.ProcessName)) n'a aucune fenêtre visible (pas encore ouverte, ou affichée par un autre processus)." }
    }
    Fail ('aucune fenêtre visible ne correspond.' + $hint + ' Lister : uia_dump.ps1 -ProcessId <PID> -ListWindows')
  }
  $main = @($cands | Where-Object { $_.Owner -eq [IntPtr]::Zero -and $_.Title -ne '' -and -not $_.IsToolWindow })
  $pick = @(if ($WindowTitle -or $main.Count -eq 0) { $cands } else { $main })
  $target = $pick[0]
  if ($pick.Count -gt 1) { Warn ("{0} fenêtres correspondent ; capture de la première au premier plan ({1}). Préciser -WindowTitle ou -Handle si besoin." -f $pick.Count, $target.Hex) }
}

if ($target.Minimized) {
  if (-not $Restore) { Fail 'la fenêtre est minimisée : une fenêtre minimisée ne se dessine pas. Relancer avec -Restore (la restaure sans l''activer) ou la restaurer à la main.' }
  [void][CopieurUniversel.Shot1.Native]::ShowWindow($target.Handle, 4)   # SW_SHOWNOACTIVATE
  Start-Sleep -Milliseconds 700
  $all = [CopieurUniversel.Shot1.Win]::TopWindows($true)
  $target = @($all | Where-Object { $_.Handle -eq $target.Handle })[0]
  if (-not $target -or $target.Minimized) { Fail 'la fenêtre n''a pas pu être restaurée.' }
}
$prevFg = [IntPtr]::Zero
if ($Activate) {
  $prevFg = [CopieurUniversel.Shot1.Native]::GetForegroundWindow()
  if (-not [CopieurUniversel.Shot1.Capture]::Activate($target.Handle)) {
    Warn 'la fenêtre n''a pas pu passer au premier plan (Windows bloque parfois ce changement) : la cliquer, puis relancer.'
  }
  Start-Sleep -Milliseconds ([Math]::Max(0, $DelayMs))   # laisser l'appli se redessiner (WinUI suspend son rendu quand elle est masquée)
  $all = [CopieurUniversel.Shot1.Win]::TopWindows($true)
  $target = @($all | Where-Object { $_.Handle -eq $target.Handle })[0]
}
function Restore-Foreground {
  if ($prevFg -ne [IntPtr]::Zero -and $prevFg -ne $target.Handle) { [void][CopieurUniversel.Shot1.Capture]::Activate($prevFg) }
}

# Calques : la fenêtre, puis ses fenêtres surgissantes (du bas vers le haut)
# Appli UWP : ApplicationFrameHost héberge les cadres de TOUTES les applis UWP ; seul le processus de l'appli compte.
$procPids = [int[]]@($(if ($target.AppPid) { $target.AppPid } else { $target.Pid }))
$layers = @($target)
if ($IncludePopups) {
  $pops = @($all | Where-Object {
      $_.Handle -ne $target.Handle -and -not $_.Cloaked -and $_.Width -gt 0 -and $_.Height -gt 0 -and
      ($procPids -contains $_.Pid) -and ($_.Owner -eq $target.Handle -or $_.IsPopup) -and $_.Z -lt $target.Z })
  $layers = @($target) + @($pops | Sort-Object Z -Descending)
}

function Get-Area($w) {
  if ($NoCrop -and $w.Handle -eq $target.Handle) { return [CopieurUniversel.Shot1.Capture]::WindowRect($w) }
  return $w.Frame
}
# Rectangle du contenu d'une fenêtre surgissante, sans sa marge d'ombre ($bmp : son rendu PrintWindow).
function Get-PopupBox($w, $bmp) {
  $a = Get-Area $w
  $box = [CopieurUniversel.Shot1.Capture]::ContentBox($bmp)
  if ($box.Width -ge $bmp.Width -and $box.Height -ge $bmp.Height) { return @{ area = $a; box = $null } }
  $notes.Add(("marge d'ombre de la fenêtre surgissante {0} retirée ({1} px à gauche, {2} en haut, {3} à droite, {4} en bas)" -f $w.Hex, $box.X, $box.Y, ($bmp.Width - $box.Right), ($bmp.Height - $box.Bottom)))
  return @{ area = [System.Drawing.Rectangle]::new($a.X + $box.X, $a.Y + $box.Y, $box.Width, $box.Height); box = $box }
}
# Fenêtres d'autres processus au-dessus de la cible : la barre des tâches est simplement rendue transparente,
# toute autre fenêtre bloque la capture d'écran (son contenu appartient à l'utilisateur).
$shellClasses = @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd')
function Get-Occluders {
  $areas = [System.Drawing.Rectangle[]]@($layers | ForEach-Object { Get-Area $_ })
  $occ = @([CopieurUniversel.Shot1.Capture]::Occluders($all, $target, $procPids, $areas))
  return @{
    bloquants = @($occ | Where-Object { $shellClasses -notcontains $_.ClassName })
    barre     = [System.Drawing.Rectangle[]]@($occ | Where-Object { $shellClasses -contains $_.ClassName } | ForEach-Object { $_.Frame })
  }
}

$bitmaps = New-Object 'System.Collections.Generic.List[System.Drawing.Bitmap]'
$rects = New-Object 'System.Collections.Generic.List[System.Drawing.Rectangle]'
$used = $Method
$notes = New-Object System.Collections.Generic.List[string]
$islands = [CopieurUniversel.Shot1.Capture]::CompositionHosts($target.Handle)

if ($Method -ne 'Screen') {
  $ok = $true
  foreach ($w in $layers) {
    $err = $null
    $bmp = [CopieurUniversel.Shot1.Capture]::Print($w, (-not ($NoCrop -and $w.Handle -eq $target.Handle)), [ref]$err)
    if (-not $bmp) { $ok = $false; $notes.Add("PrintWindow : $err ($($w.Hex))"); break }
    if ([CopieurUniversel.Shot1.Capture]::Uniform($bmp)) {
      $notes.Add("image PrintWindow uniforme pour $($w.Hex) (rendu GPU non transmis ?)")
      if ($Method -eq 'Auto') { $ok = $false; $bmp.Dispose(); break }
    }
    $area = Get-Area $w
    if ($w.Handle -ne $target.Handle) {
      $pb = Get-PopupBox $w $bmp
      if ($pb.box) { $c = $bmp.Clone($pb.box, $bmp.PixelFormat); $bmp.Dispose(); $bmp = $c; $area = $pb.area }
    }
    $bitmaps.Add($bmp); $rects.Add($area)
  }
  if ($ok -and $islands -and $Method -eq 'Auto') {
    # PrintWindow laisse souvent les zones WinUI/XAML vides : capture d'écran si la fenêtre est dégagée.
    # Mais si une partie passe sous la barre des tâches, la capture d'écran la rendrait transparente
    # (barre d'état perdue, vu sur le Bloc-notes) : PrintWindow est alors gardé.
    $o = Get-Occluders
    if ($o.bloquants.Count -eq 0 -and $o.barre.Count -gt 0) {
      $notes.Add("îlots de composition ($islands), mais une partie de la fenêtre passe sous la barre des tâches : PrintWindow gardé (une capture d'écran la rendrait transparente). Si des zones WinUI sont vides sur l'image : déplacer la fenêtre au-dessus de la barre, ou -Activate.")
    } elseif ($o.bloquants.Count -eq 0) {
      $ok = $false
      $notes.Add("îlots de composition ($islands) : capture d'écran préférée à PrintWindow (-Method PrintWindow pour comparer)")
    } else {
      $notes.Add("contenu WinUI/XAML ($islands) : PrintWindow peut laisser des zones VIDES (onglets, menus, barres). Pour une image complète : -Activate (met la fenêtre devant le temps de la capture), puis comparer.")
    }
  }
  if ($ok) { $used = 'PrintWindow' }
  elseif ($Method -eq 'PrintWindow') { Restore-Foreground; Fail ('PrintWindow impossible : ' + ($notes -join ' ; ') + '. Essayer -Method Screen (fenêtre visible et non recouverte).') }
  else { foreach ($b in $bitmaps) { $b.Dispose() }; $bitmaps.Clear(); $rects.Clear() }
}

if ($bitmaps.Count -eq 0) {
  $used = 'Screen'
  $o = Get-Occluders
  if ($o.bloquants.Count -gt 0 -and -not $Force) {
    $lst = ($o.bloquants | Select-Object -First 5 | ForEach-Object { '{0} ({1})' -f $_.Process, $_.ClassName }) -join ', '
    Restore-Foreground
    Fail ("capture d'écran refusée : la fenêtre est recouverte par d'autres fenêtres ($lst) dont le contenu se retrouverait dans l'image. " +
      "Relancer avec -Activate (met la fenêtre devant puis rend la main), ou la mettre devant à la main ; -Force pour passer outre en connaissance de cause." +
      $(if ($notes.Count) { ' Détail : ' + ($notes -join ' ; ') } else { '' }))
  }
  $areas = @($layers | ForEach-Object { Get-Area $_ })
  $ux = ($areas | Measure-Object -Property X -Minimum).Minimum
  $uy = ($areas | Measure-Object -Property Y -Minimum).Minimum
  $ur = ($areas | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
  $ub = ($areas | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
  $union = [System.Drawing.Rectangle]::new([int]$ux, [int]$uy, [int]($ur - $ux), [int]($ub - $uy))
  try { $screen = [CopieurUniversel.Shot1.Capture]::Screen($union) }
  catch { Restore-Foreground; Fail ('copie de l''écran impossible (session verrouillée ou bureau sécurisé ?) : ' + $_.Exception.Message) }
  for ($li = 0; $li -lt $layers.Count; $li++) {
    $a = $areas[$li]; $lw = $layers[$li]
    $crop = [CopieurUniversel.Shot1.Capture]::Crop($screen, $a, $union)
    if ($o.barre.Count -gt 0) {
      $clr = [CopieurUniversel.Shot1.Capture]::ClearAreas($crop, $a, $o.barre); $crop.Dispose(); $crop = $clr
    }
    if ($lw.Handle -ne $target.Handle) {
      # Marge d'ombre : à l'écran elle laisse voir ce qui est DERRIÈRE le menu (fenêtres de l'utilisateur).
      # Son contour exact vient du rendu PrintWindow de la fenêtre surgissante.
      $perr = $null
      $pbmp = [CopieurUniversel.Shot1.Capture]::Print($lw, $true, [ref]$perr)
      if ($pbmp) {
        $pb = Get-PopupBox $lw $pbmp
        $pbmp.Dispose()
        if ($pb.box) {
          $bx = [System.Drawing.Rectangle]::Intersect($pb.box, [System.Drawing.Rectangle]::new(0, 0, $crop.Width, $crop.Height))
          if ($bx.Width -gt 0 -and $bx.Height -gt 0) { $c = $crop.Clone($bx, $crop.PixelFormat); $crop.Dispose(); $crop = $c; $a = $pb.area }
        }
      } else {
        $notes.Add("fenêtre surgissante $($lw.Hex) : marge d'ombre non vérifiée (PrintWindow : $perr) ; regarder les bords de l'image")
      }
    }
    $bitmaps.Add($crop); $rects.Add($a)
  }
  $screen.Dispose()
  if ($o.barre.Count -gt 0) { $notes.Add('partie de la fenêtre sous la barre des tâches : laissée transparente') }
  if ([CopieurUniversel.Shot1.Capture]::Uniform($bitmaps[0])) { $notes.Add('l''image obtenue est uniforme : la fenêtre ne se dessine peut-être pas (minimisée, autre bureau, appli protégée).') }
}
Restore-Foreground

# Assemblage et écriture
$decX = 0; $decY = 0
if ($bitmaps.Count -eq 1) { $final = $bitmaps[0] }
else {
  $minX = ($rects | Measure-Object -Property X -Minimum).Minimum
  $minY = ($rects | Measure-Object -Property Y -Minimum).Minimum
  $maxR = ($rects | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
  $maxB = ($rects | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
  $u = [System.Drawing.Rectangle]::new([int]$minX, [int]$minY, [int]($maxR - $minX), [int]($maxB - $minY))
  $final = [CopieurUniversel.Shot1.Capture]::Compose($bitmaps, $rects, $u)
  # Position du cadre de la fenêtre principale dans l'image : un menu qui déborde à gauche ou en haut décale
  # l'origine ; ajouter ce décalage aux rectangles de uia_dump.ps1 pour les superposer à l'image.
  $decX = [int]($rects[0].X - $minX); $decY = [int]($rects[0].Y - $minY)
}
$full = [IO.Path]::GetFullPath($Out)
$dir = Split-Path -Parent $full
if ($dir) { [void](New-Item -ItemType Directory -Force -Path $dir) }
$fmt = $(if ($full -match '\.jpe?g$') { [System.Drawing.Imaging.ImageFormat]::Jpeg } else { [System.Drawing.Imaging.ImageFormat]::Png })
$final.Save($full, $fmt)

$origin = $(if ($bitmaps.Count -gt 1) { 'coin haut-gauche de l''ensemble fenêtre + surgissantes (position de la fenêtre : voir cadreEcran)' } elseif ($NoCrop) { 'rectangle complet de la fenêtre (bordures invisibles comprises)' } else { 'cadre visible de la fenêtre (DWM), même origine que uia_dump.ps1' })
$J = [CopieurUniversel.Shot1.Json]
$summary = '{"fichier": ' + $J::Q($full) +
  ', "methode": ' + $J::Q($used) +
  ', "largeur": ' + $final.Width + ', "hauteur": ' + $final.Height +
  ', "fenetres": ' + $bitmaps.Count +
  ', "handle": ' + $J::Q($target.Hex) + ', "processus": ' + $J::Q($target.Process) + ', "pid": ' + $target.Pid +
  ', "cadreEcran": ' + $J::Rect($target.Left, $target.Top, $target.Width, $target.Height) +
  ', "dpi": ' + $target.Dpi + ', "dpiEcran": ' + $target.MonitorDpi + ', "echelle": ' + $J::N($target.Scale) + ', "dpiProcessus": ' + $J::Q($dpiMode) +
  $(if ($target.StretchedByWindows) { ', "agrandieParWindows": true' } else { '' }) +
  ', "composition": ' + $J::Q($islands) +
  ', "decalage": {"x": ' + $decX + ', "y": ' + $decY + '}' +
  ', "origine": ' + $J::Q($origin) + '}'
foreach ($n in $notes) { Warn $n }
Write-Utf8 ('OK window_shot : ' + $summary)
foreach ($b in $bitmaps) { $b.Dispose() }
exit 0
