#Requires -Version 5.1
<#
.SYNOPSIS
  Arbre UI Automation d'une fenêtre Windows -> JSON (plugin copieur-universel, skill capture-bureau).

.DESCRIPTION
  Relève ce qu'une appli de bureau MONTRE (types de contrôles, noms, AutomationId, classes, frameworks,
  rectangles relatifs à la fenêtre, états, patterns disponibles, enfants) pour la recréer fidèlement.
  Windows uniquement (Windows PowerShell 5.1 ou PowerShell 7 sous Windows).

  Confidentialité : les VALEURS des champs (texte saisi) ne sont PAS relevées par défaut (seulement leur
  longueur) ; les mots de passe jamais. Emails, téléphones, IBAN, cartes et clés sont masqués dans les noms,
  titres et textes d'aide (désactivable avec -NoMask). Les noms de personnes ne sont pas détectés : utiliser
  un document ou un profil fictif. Les lignes de tableau (DataItem) sont limitées à -MaxItems (10) et les
  éléments de liste/arbre à -MaxListItems (40) par parent : leurs noms portent les données.

  Coordonnées : pixels PHYSIQUES (le script se déclare « DPI aware »), relatifs au coin haut-gauche du cadre
  visible de la fenêtre (DWM) - la même origine que window_shot.ps1. Diviser par « echelle » pour des px CSS.

  Navigation prudente (facultative, avant le relevé) - aucune ne valide ni n'enregistre quoi que ce soit :
    -Expand "Fichier"[,"Sous-menu"]  déplie menus, listes déroulantes, nœuds d'arbre (ExpandCollapse), puis
                                     les replie après le relevé (sauf -KeepOpen) ; plusieurs niveaux :
                                     -Expand "Affichage,Zoom" (virgule ; un nom contenant une virgule n'est pas pris).
                                     Refusé : un sous-menu de fichiers récents (nom contenant récent(s/e/es),
                                     récemment, recent, recently, historique, history, MRU : « Ouvrir récent »,
                                     « Médias récents », « Recently Opened »…), qui montrerait les fichiers de
                                     l'utilisateur ; -AllowRecent seulement si la liste est fictive.
    -SelectTab "Affichage"           sélectionne un onglet (TabItem uniquement)
    -Invoke "Mise en page"           active UNIQUEMENT un menu/bouton qui ouvre une boîte de dialogue ou une vue :
                                     nom finissant par « … »/« ... » (convention Windows), ou liste blanche
                                     (Options, Paramètres, Préférences, Propriétés, À propos, Mise en page,
                                     Police, Rechercher, Remplacer, Atteindre, et équivalents anglais ; ces cinq
                                     derniers en élément de MENU seulement : sur un bouton de boîte de dialogue,
                                     « Remplacer » remplacerait le texte). Jamais, même avec « … », où que soit
                                     le mot dans le nom : Enregistrer, Ouvrir, Parcourir, Imprimer, Exporter,
                                     Supprimer, Envoyer, Quitter, Fermer, Se déconnecter, Réinitialiser, Mettre à
                                     jour (« Rechercher les mises à jour… », « Check for Updates... »), Installer,
                                     Se connecter / Connexion, Ajouter un dossier / des fichiers, Télécharger ;
                                     ni Aide/Help, Bing, Web (navigateur).
                                     Un élément d'un menu fermé : -Expand "Fichier" -Invoke "Mise en page"
    -CloseWindow "Mise en page"      ferme une boîte de dialogue de l'appli (WM_CLOSE = Annuler) ; jamais la
                                     fenêtre principale
    -KeepOpen / -CloseMenus          laisser le menu ouvert pour window_shot.ps1 -IncludePopups, puis le refermer
                                     (repli UIA, et WM_CANCELMODE pour les menus Win32 classiques)

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File uia_dump.ps1 -ProcessId 1234 -Out C:\travail\uia-principale.json
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File uia_dump.ps1 -ProcessId 1234 -ListWindows
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File uia_dump.ps1 -ProcessId 1234 -Expand "Fichier" -Out C:\travail\uia-menu-fichier.json
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File uia_dump.ps1 -Handle 0x1A2B3C -Depth 8 -AllWindows
#>
[CmdletBinding()]
param(
  [string]$ProcessName,
  [string]$WindowTitle,
  [string]$Handle,
  [int]$ProcessId,
  [int]$Depth = 25,
  [string]$Out,
  [switch]$IncludeValues,
  [switch]$NoMask,
  [switch]$AllWindows,
  [switch]$ListWindows,
  [switch]$RawView,
  [int]$MaxNodes = 20000,
  [int]$MaxItems = 10,
  [int]$MaxListItems = 40,
  [string[]]$Expand,
  [string]$SelectTab,
  [string]$Invoke,
  [string]$CloseWindow,
  [switch]$KeepOpen,
  [switch]$CloseMenus,
  [switch]$AllowRecent,
  [int]$WaitMs = 800
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script:Version = '1.1'

# ---------------------------------------------------------------------------------------------------------
# Sorties : UTF-8 brut quand la sortie est redirigée (outils Bash/PowerShell), console sinon.
# ---------------------------------------------------------------------------------------------------------
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
  Fail 'uia_dump.ps1 ne fonctionne que sous Windows (UI Automation). Sous macOS/Linux : captures d''écran et observation.'
}

# ---------------------------------------------------------------------------------------------------------
# Cœur en C# (C# 5, compilé une fois par session)
# ---------------------------------------------------------------------------------------------------------
$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

namespace CopieurUniversel.Uia1
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
        // InternalGetWindowText n'envoie aucun message (GetWindowTextLength bloque sur une appli figée).
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
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
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
                        if (ch < 0x20 || ch == '\u2028' || ch == '\u2029') sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
        public static string N(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
            return d.ToString("0.###", CultureInfo.InvariantCulture);
        }
        public static string I(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
            return Math.Round(d).ToString("0", CultureInfo.InvariantCulture);
        }
        public static string Rect(double x, double y, double w, double h)
        {
            return "{\"x\": " + I(x) + ", \"y\": " + I(y) + ", \"w\": " + I(w) + ", \"h\": " + I(h) + "}";
        }
    }

    public class Masker
    {
        public bool Enabled = true;
        public int Count = 0;
        static readonly Regex Email = new Regex(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", RegexOptions.Compiled);
        static readonly Regex PhoneIntl = new Regex(@"(?<![\w+])\+\d[\d \u00a0\u202f().-]{6,18}\d(?!\d)", RegexOptions.Compiled);
        static readonly Regex PhoneFr = new Regex(@"(?<![\d+])0[1-9](?:[ .\u00a0\u202f-]?\d{2}){4}(?!\d)", RegexOptions.Compiled);
        static readonly Regex Secret = new Regex(@"\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})", RegexOptions.Compiled);
        static readonly Regex Iban = new Regex(@"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b", RegexOptions.Compiled);
        static readonly Regex Card = new Regex(@"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)", RegexOptions.Compiled);
        const string Dots = "\u2022\u2022\u2022\u2022";

        static bool Luhn(string d)
        {
            int s = 0; bool alt = false;
            for (int i = d.Length - 1; i >= 0; i--) { int n = d[i] - '0'; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
            return s % 10 == 0;
        }
        static bool IbanOk(string s)
        {
            s = s.Replace(" ", "");
            if (s.Length < 15 || s.Length > 34) return false;
            s = s.Substring(4) + s.Substring(0, 4);
            int r = 0;
            foreach (char c in s)
            {
                string v = c >= 'A' && c <= 'Z' ? ((int)c - 55).ToString(CultureInfo.InvariantCulture) : c.ToString();
                foreach (char d in v) r = (r * 10 + (d - '0')) % 97;
            }
            return r == 1;
        }
        public string Apply(string s)
        {
            if (!Enabled || string.IsNullOrEmpty(s) || s.Length < 6) return s;
            string r = Secret.Replace(s, delegate(Match m) { Count++; return m.Value.Substring(0, 4) + Dots + Dots + m.Value.Substring(m.Value.Length - 4); });
            r = Email.Replace(r, delegate(Match m) { Count++; return "contact@exemple.com"; });
            r = Iban.Replace(r, delegate(Match m) { if (!IbanOk(m.Value)) return m.Value; Count++; string c = m.Value.Replace(" ", ""); return c.Substring(0, 4) + " " + Dots + " " + Dots + " " + c.Substring(c.Length - 4); });
            r = Card.Replace(r, delegate(Match m) { string d = Regex.Replace(m.Value, @"\D", ""); if (d.Length < 13 || !Luhn(d)) return m.Value; Count++; return Dots + " " + Dots + " " + Dots + " " + d.Substring(d.Length - 4); });
            r = PhoneIntl.Replace(r, delegate(Match m) { Count++; return "+33 6 00 00 00 00"; });
            r = PhoneFr.Replace(r, delegate(Match m) { Count++; return "06 00 00 00 00"; });
            return r;
        }
    }

    public class Win
    {
        public IntPtr Handle; public int Pid; public int AppPid; public string Process = ""; public string AppProcess = "";
        public string Title = ""; public string ClassName = ""; public bool Visible; public bool Minimized; public bool Cloaked;
        public IntPtr Owner; public int Left, Top, Width, Height; public int Style, ExStyle; public int Z; public int Dpi; public int MonitorDpi;

        public bool HasCaption { get { return (Style & 0x00C00000) == 0x00C00000; } }
        public bool IsPopup { get { return (Style & unchecked((int)0x80000000)) != 0 && !HasCaption; } }
        public bool IsToolWindow { get { return (ExStyle & 0x80) != 0; } }
        public string Hex { get { return "0x" + Handle.ToInt64().ToString("X"); } }
        // Échelle pour convertir en px CSS : celle de l'ÉCRAN (une appli non DPI-aware renvoie 96 mais Windows
        // l'agrandit quand même à l'échelle de l'écran).
        public double Scale { get { return MonitorDpi > 0 ? MonitorDpi / 96.0 : (Dpi > 0 ? Dpi / 96.0 : 1.0); } }
        public bool StretchedByWindows { get { return Dpi == 96 && MonitorDpi > 96; } }

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
            var sb = new StringBuilder(1024);
            Native.InternalGetWindowText(h, sb, sb.Capacity);
            w.Title = sb.ToString();
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

        public string ToJson(Masker m, int ox, int oy)
        {
            var sb = new StringBuilder("{");
            sb.Append("\"handle\": ").Append(Json.Q(Hex));
            sb.Append(", \"titre\": ").Append(Json.Q(m.Apply(Title)));
            sb.Append(", \"processus\": ").Append(Json.Q(Process)).Append(", \"pid\": ").Append(Pid);
            if (AppPid != 0) sb.Append(", \"appliProcessus\": ").Append(Json.Q(AppProcess)).Append(", \"appliPid\": ").Append(AppPid);
            sb.Append(", \"classe\": ").Append(Json.Q(ClassName));
            sb.Append(", \"cadreEcran\": ").Append(Json.Rect(Left, Top, Width, Height));
            sb.Append(", \"position\": ").Append(Json.Rect(Left - ox, Top - oy, Width, Height));
            sb.Append(", \"minimisee\": ").Append(Minimized ? "true" : "false");
            sb.Append(", \"cachee\": ").Append(Cloaked ? "true" : "false");
            sb.Append(", \"proprietaire\": ").Append(Owner == IntPtr.Zero ? "null" : Json.Q("0x" + Owner.ToInt64().ToString("X")));
            sb.Append(", \"dpi\": ").Append(Dpi).Append(", \"dpiEcran\": ").Append(MonitorDpi).Append(", \"echelle\": ").Append(Json.N(Scale));
            if (StretchedByWindows) sb.Append(", \"agrandieParWindows\": true");
            sb.Append("}");
            return sb.ToString();
        }
    }

    public class Dumper
    {
        public int MaxDepth = 25, MaxNodes = 20000, MaxItems = 10, MaxListItems = 40, ItemsNotShown = 0;
        public bool IncludeValues = false;
        public Masker Mask = new Masker();
        public int OriginX, OriginY;
        public int Nodes, Deepest, Errors, NotShown;
        public bool Truncated;
        readonly CacheRequest cache;
        readonly TreeWalker walker;

        static readonly AutomationProperty[] BaseProps = {
            AutomationElement.ControlTypeProperty, AutomationElement.LocalizedControlTypeProperty, AutomationElement.NameProperty,
            AutomationElement.AutomationIdProperty, AutomationElement.ClassNameProperty, AutomationElement.FrameworkIdProperty,
            AutomationElement.BoundingRectangleProperty, AutomationElement.IsEnabledProperty, AutomationElement.IsOffscreenProperty,
            AutomationElement.HasKeyboardFocusProperty, AutomationElement.AcceleratorKeyProperty, AutomationElement.AccessKeyProperty,
            AutomationElement.HelpTextProperty, AutomationElement.ItemStatusProperty, AutomationElement.IsPasswordProperty,
            AutomationElement.NativeWindowHandleProperty };
        static readonly string[] PatNames = { "Invoke", "ExpandCollapse", "Toggle", "SelectionItem", "Selection", "Value", "RangeValue",
            "Scroll", "ScrollItem", "Text", "Window", "Grid", "GridItem", "Table", "TableItem", "Transform", "Dock", "MultipleView",
            "VirtualizedItem", "ItemContainer", "SynchronizedInput" };
        static readonly AutomationProperty[] PatProps = {
            AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
            AutomationElement.IsTogglePatternAvailableProperty, AutomationElement.IsSelectionItemPatternAvailableProperty,
            AutomationElement.IsSelectionPatternAvailableProperty, AutomationElement.IsValuePatternAvailableProperty,
            AutomationElement.IsRangeValuePatternAvailableProperty, AutomationElement.IsScrollPatternAvailableProperty,
            AutomationElement.IsScrollItemPatternAvailableProperty, AutomationElement.IsTextPatternAvailableProperty,
            AutomationElement.IsWindowPatternAvailableProperty, AutomationElement.IsGridPatternAvailableProperty,
            AutomationElement.IsGridItemPatternAvailableProperty, AutomationElement.IsTablePatternAvailableProperty,
            AutomationElement.IsTableItemPatternAvailableProperty, AutomationElement.IsTransformPatternAvailableProperty,
            AutomationElement.IsDockPatternAvailableProperty, AutomationElement.IsMultipleViewPatternAvailableProperty,
            AutomationElement.IsVirtualizedItemPatternAvailableProperty, AutomationElement.IsItemContainerPatternAvailableProperty,
            AutomationElement.IsSynchronizedInputPatternAvailableProperty };
        static readonly AutomationProperty[] StateProps = {
            TogglePattern.ToggleStateProperty, ExpandCollapsePattern.ExpandCollapseStateProperty, SelectionItemPattern.IsSelectedProperty,
            ValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty, RangeValuePattern.ValueProperty, RangeValuePattern.MinimumProperty,
            RangeValuePattern.MaximumProperty, WindowPattern.WindowVisualStateProperty, WindowPattern.IsModalProperty,
            GridPattern.RowCountProperty, GridPattern.ColumnCountProperty };

        public Dumper(bool raw)
        {
            cache = new CacheRequest();
            cache.TreeScope = TreeScope.Element;
            foreach (var p in BaseProps) cache.Add(p);
            foreach (var p in PatProps) cache.Add(p);
            foreach (var p in StateProps) cache.Add(p);
            walker = raw ? TreeWalker.RawViewWalker : TreeWalker.ControlViewWalker;
        }

        object Get(AutomationElement e, AutomationProperty p)
        {
            try { object v = e.GetCachedPropertyValue(p, true); return v == AutomationElement.NotSupported ? null : v; }
            catch (Exception) { return null; }
        }
        string S(AutomationElement e, AutomationProperty p) { object v = Get(e, p); return v == null ? "" : v.ToString(); }
        bool B(AutomationElement e, AutomationProperty p) { object v = Get(e, p); return v is bool && (bool)v; }
        static void P(StringBuilder sb, string key, string raw) { sb.Append(", \"").Append(key).Append("\": ").Append(raw); }
        void PIf(StringBuilder sb, string key, string val) { if (!string.IsNullOrEmpty(val)) P(sb, key, Json.Q(val)); }

        int ItemKind(AutomationElement e)  // 1 = ligne de tableau, 2 = élément de liste ou d'arbre, 0 = autre
        {
            object v = Get(e, AutomationElement.ControlTypeProperty);
            if (v == ControlType.DataItem) return 1;
            if (v == ControlType.ListItem || v == ControlType.TreeItem) return 2;
            return 0;
        }
        AutomationElement First(AutomationElement e) { try { return walker.GetFirstChild(e, cache); } catch (Exception) { Errors++; return null; } }
        AutomationElement Next(AutomationElement e) { try { return walker.GetNextSibling(e, cache); } catch (Exception) { Errors++; return null; } }

        public string DumpRoot(IntPtr hwnd, string ind)
        {
            AutomationElement root = AutomationElement.FromHandle(hwnd).GetUpdatedCache(cache);
            var sb = new StringBuilder();
            Node(sb, root, 0, ind);
            return sb.ToString();
        }

        // Relevé sur un fil MTA (voir Actions.OnMta).
        public string DumpRootMta(IntPtr hwnd, string ind, int timeoutMs)
        {
            string res = null; Exception err = null;
            var t = new Thread(delegate() { try { res = DumpRoot(hwnd, ind); } catch (Exception ex) { err = ex; } });
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.MTA);
            t.Start();
            if (!t.Join(timeoutMs)) throw new TimeoutException("UI Automation ne répond pas après " + (timeoutMs / 1000) + " s");
            if (err != null) throw new InvalidOperationException(err.GetType().Name + " : " + err.Message);
            return res;
        }

        void Node(StringBuilder sb, AutomationElement e, int depth, string ind)
        {
            Nodes++;
            if (depth > Deepest) Deepest = depth;
            object ctv = Get(e, AutomationElement.ControlTypeProperty);
            string ct = ctv is ControlType ? ((ControlType)ctv).ProgrammaticName.Replace("ControlType.", "") : "";
            sb.Append("{\"ControlType\": ").Append(Json.Q(ct));
            PIf(sb, "LocalizedControlType", S(e, AutomationElement.LocalizedControlTypeProperty));
            P(sb, "Name", Json.Q(Mask.Apply(S(e, AutomationElement.NameProperty))));
            PIf(sb, "AutomationId", S(e, AutomationElement.AutomationIdProperty));
            PIf(sb, "ClassName", S(e, AutomationElement.ClassNameProperty));
            PIf(sb, "FrameworkId", S(e, AutomationElement.FrameworkIdProperty));
            object rv = Get(e, AutomationElement.BoundingRectangleProperty);
            if (rv is System.Windows.Rect && !((System.Windows.Rect)rv).IsEmpty)
            {
                var r = (System.Windows.Rect)rv;
                P(sb, "BoundingRectangle", Json.Rect(r.X - OriginX, r.Y - OriginY, r.Width, r.Height));
            }
            else P(sb, "BoundingRectangle", "null");
            P(sb, "IsEnabled", B(e, AutomationElement.IsEnabledProperty) ? "true" : "false");
            P(sb, "IsOffscreen", B(e, AutomationElement.IsOffscreenProperty) ? "true" : "false");

            var pats = new List<string>();
            for (int i = 0; i < PatProps.Length; i++) if (B(e, PatProps[i])) pats.Add(Json.Q(PatNames[i]));
            if (pats.Count > 0) P(sb, "Patterns", "[" + string.Join(", ", pats.ToArray()) + "]");

            var st = new List<string>();
            object tv = Get(e, TogglePattern.ToggleStateProperty); if (tv != null) st.Add("\"Toggle\": " + Json.Q(tv.ToString()));
            object ev = Get(e, ExpandCollapsePattern.ExpandCollapseStateProperty); if (ev != null) st.Add("\"ExpandCollapse\": " + Json.Q(ev.ToString()));
            object sv = Get(e, SelectionItemPattern.IsSelectedProperty); if (sv is bool) st.Add("\"Selected\": " + ((bool)sv ? "true" : "false"));
            if (B(e, AutomationElement.HasKeyboardFocusProperty)) st.Add("\"Focused\": true");
            object wv = Get(e, WindowPattern.WindowVisualStateProperty); if (wv != null) st.Add("\"WindowVisualState\": " + Json.Q(wv.ToString()));
            object mv = Get(e, WindowPattern.IsModalProperty); if (mv is bool && (bool)mv) st.Add("\"Modal\": true");
            object rows = Get(e, GridPattern.RowCountProperty), cols = Get(e, GridPattern.ColumnCountProperty);
            if (rows is int) st.Add("\"Rows\": " + rows + ", \"Columns\": " + (cols is int ? cols.ToString() : "null"));
            object rgv = Get(e, RangeValuePattern.ValueProperty);
            if (rgv is double)
            {
                object mn = Get(e, RangeValuePattern.MinimumProperty), mx = Get(e, RangeValuePattern.MaximumProperty);
                st.Add("\"Range\": {\"value\": " + Json.N((double)rgv) + ", \"min\": " + (mn is double ? Json.N((double)mn) : "null")
                       + ", \"max\": " + (mx is double ? Json.N((double)mx) : "null") + "}");
            }
            if (st.Count > 0) P(sb, "States", "{" + string.Join(", ", st.ToArray()) + "}");

            bool pwd = B(e, AutomationElement.IsPasswordProperty);
            object vv = Get(e, ValuePattern.ValueProperty);
            if (vv != null)
            {
                string val = vv.ToString();
                if (pwd) P(sb, "Value", Json.Q(val.Length > 0 ? "[mot de passe]" : ""));
                else if (IncludeValues) P(sb, "Value", Json.Q(Mask.Apply(val)));
                else P(sb, "Value", Json.Q(val.Length == 0 ? "" : "[masqu\u00e9e : " + val.Length + " caract\u00e8res]"));
                if (B(e, ValuePattern.IsReadOnlyProperty)) P(sb, "ReadOnly", "true");
            }
            if (pwd) P(sb, "IsPassword", "true");
            PIf(sb, "AcceleratorKey", S(e, AutomationElement.AcceleratorKeyProperty));
            PIf(sb, "AccessKey", S(e, AutomationElement.AccessKeyProperty));
            PIf(sb, "HelpText", Mask.Apply(S(e, AutomationElement.HelpTextProperty)));
            PIf(sb, "ItemStatus", Mask.Apply(S(e, AutomationElement.ItemStatusProperty)));
            object nh = Get(e, AutomationElement.NativeWindowHandleProperty);
            if (nh is int && (int)nh != 0) P(sb, "NativeWindowHandle", Json.Q("0x" + ((int)nh).ToString("X")));

            if (depth >= MaxDepth)
            {
                int n = 0; var c = First(e);
                while (c != null && n < 100000) { n++; c = Next(c); }
                if (n > 0) { P(sb, "ChildrenNotShown", n.ToString(CultureInfo.InvariantCulture)); Truncated = true; NotShown += n; }
            }
            else
            {
                var c = First(e);
                if (c != null)
                {
                    string ci = ind + "  ";
                    sb.Append(", \"Children\": [");
                    bool first = true;
                    int rest = 0, rowItems = 0, listItems = 0, restItems = 0;
                    while (c != null)
                    {
                        if (Nodes >= MaxNodes) { rest++; Truncated = true; c = Next(c); continue; }
                        // Lignes de tableau (et longues listes) : leurs noms portent les DONNÉES, souvent personnelles ;
                        // quelques-unes suffisent pour comprendre la structure (comme les 10 lignes du kit web).
                        int kind = ItemKind(c);
                        if ((kind == 1 && MaxItems > 0 && ++rowItems > MaxItems) || (kind == 2 && MaxListItems > 0 && ++listItems > MaxListItems))
                        { restItems++; c = Next(c); continue; }
                        sb.Append(first ? "\n" : ",\n").Append(ci);
                        first = false;
                        Node(sb, c, depth + 1, ci);
                        c = Next(c);
                    }
                    sb.Append("\n").Append(ind).Append("]");
                    if (rest > 0) { P(sb, "ChildrenNotShown", rest.ToString(CultureInfo.InvariantCulture)); NotShown += rest; }
                    if (restItems > 0) { P(sb, "ItemsNotShown", restItems.ToString(CultureInfo.InvariantCulture)); ItemsNotShown += restItems; }
                }
            }
            sb.Append("}");
        }
    }

    public static class Actions
    {
        public static List<AutomationElement> Roots(Win[] wins)
        {
            var l = new List<AutomationElement>();
            if (wins == null) return l;
            foreach (var w in wins) { if (w == null) continue; try { l.Add(AutomationElement.FromHandle(w.Handle)); } catch (Exception) { } }
            return l;
        }
        public static string Norm(string s)
        {
            s = (s ?? "").Replace("&", "");
            int t = s.IndexOf('\t'); if (t >= 0) s = s.Substring(0, t);
            s = Regex.Replace(s.Trim(), @"(\u2026|\.\.\.)$", "").Trim();
            return Regex.Replace(s, @"\s+", " ").ToLowerInvariant();
        }
        public static bool EndsWithEllipsis(string s)
        {
            s = (s ?? "").Trim();
            int t = s.IndexOf('\t'); if (t >= 0) s = s.Substring(0, t).Trim();
            return s.EndsWith("\u2026") || s.EndsWith("...");
        }
        // Commandes qui ouvrent une vue ou une bo\u00eete de dialogue sans agir (les applis r\u00e9centes n'\u00e9crivent plus \u00ab \u2026 \u00bb).
        // Jamais : enregistrer, imprimer, envoyer, supprimer, quitter, fermer, nouveau, aide (ouvre le navigateur)...
        static readonly Regex SafeOpen = new Regex(@"^(options|param\u00e8tres|pr\u00e9f\u00e9rences|propri\u00e9t\u00e9s|\u00e0 propos( de .*)?|mise en page|police|rechercher|remplacer|atteindre|settings|preferences|properties|about( .*)?|page setup|font|find|replace|go to)$");
        // Ces noms ouvrent une bo\u00eete quand c'est un \u00e9l\u00e9ment de MENU, mais EX\u00c9CUTENT l'action sur un bouton de la
        // bo\u00eete elle-m\u00eame (\u00ab Remplacer \u00bb remplace le texte du document) : MenuItem seulement.
        public static readonly Regex MenuOnly = new Regex(@"^(rechercher|remplacer|atteindre|police|mise en page|find|replace|go to|font|page setup)$");
        // Jamais, m\u00eame avec \u00ab \u2026 \u00bb, O\u00d9 QUE SOIT le mot dans le nom (\u00ab Check for Updates... \u00bb ne commence pas par
        // \u00ab update \u00bb) : actions qui modifient ou envoient, mises \u00e0 jour et installations, connexion, aide et web (ouvrent
        // le navigateur), et bo\u00eetes syst\u00e8me qui montrent les fichiers ou imprimantes de l'utilisateur (Ouvrir,
        // Enregistrer sous, Parcourir, Imprimer, Exporter, Ajouter un dossier, Ins\u00e9rer une image).
        static readonly Regex Deny = new Regex(@"\b(enregistrer|sauvegarder|ouvrir|rouvrir|parcourir|importer|exporter|imprimer|supprimer|effacer|vider|quitter|fermer|se d\u00e9connecter|d\u00e9connecter|d\u00e9connexion|se connecter|connexion|s['\u2019]identifier|s['\u2019]inscrire|r\u00e9initialiser|installer|installation|d\u00e9sinstaller|mettre \u00e0 jour|mises? \u00e0 jour|mettre \u00e0 niveau|mise \u00e0 niveau|red\u00e9marrer|envoyer|publier|partager|acheter|payer|s['\u2019]abonner|renommer|d\u00e9placer|t\u00e9l\u00e9charger|aide|ajouter (?:un |des )?(?:dossiers?|fichiers?)|ins\u00e9rer (?:une |un |des )?(?:images?|fichiers?|objets?)|signaler un probl\u00e8me|save|open|reopen|browse|import|export|print|delete|remove|clear|empty|exit|quit|close|sign out|log out|logout|sign in|sign up|log in|login|reset|install\w*|uninstall|updates?|upgrade|restart|send|publish|share|buy|purchase|pay|subscribe|rename|move|download|help|feedback|report (?:an )?issue|add (?:a )?(?:folders?|files?)|insert (?:a )?(?:pictures?|images?|files?|objects?)|bing|web)\b");
        public static bool SafeToInvoke(string s) { string n = Norm(s); return !Deny.IsMatch(n) && (EndsWithEllipsis(s) || SafeOpen.IsMatch(n)); }
        static string NameOf(AutomationElement e) { try { return e.Current.Name ?? ""; } catch (Exception) { return ""; } }
        static string TypeOf(AutomationElement e) { try { return e.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""); } catch (Exception) { return "?"; } }

        public static AutomationElement Find(IList<AutomationElement> roots, string name, Condition extra)
        {
            Condition byName = new PropertyCondition(AutomationElement.NameProperty, name, PropertyConditionFlags.IgnoreCase);
            Condition c = extra == null ? byName : new AndCondition(byName, extra);
            foreach (var r in roots) { try { var e = r.FindFirst(TreeScope.Element | TreeScope.Descendants, c); if (e != null) return e; } catch (Exception) { } }
            string want = Norm(name);
            foreach (var r in roots)
            {
                try
                {
                    var all = r.FindAll(TreeScope.Descendants, extra ?? Condition.TrueCondition);
                    foreach (AutomationElement e in all) if (Norm(NameOf(e)) == want) return e;
                }
                catch (Exception) { }
            }
            return null;
        }

        // Toute opération UIA passe par un fil MTA : depuis le fil STA de powershell.exe, le même relevé est
        // jusqu'à 15 fois plus lent. Le délai protège des fournisseurs Win32 qui bloquent tant qu'un menu ou une
        // boîte modale reste ouvert.
        public static string OnMta(ThreadStart a, int ms)
        {
            string err = null;
            var t = new Thread(delegate() { try { a(); } catch (Exception ex) { err = ex.GetType().Name + " : " + ex.Message; } });
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.MTA);
            t.Start();
            if (!t.Join(ms)) return "attente";
            return err == null ? "ok" : "erreur|" + err;
        }

        static string Fmt(string r, string ty, string nm)
        {
            if (r == "ok" || r == "attente") return r + "|" + ty + "|" + nm;
            return "erreur|" + ty + "|" + nm + " (" + (r.StartsWith("erreur|") ? r.Substring(7) : r) + ")";
        }

        static AutomationElement FindMta(Win[] wins, string name, Condition extra, out string status, out string nm, out string ty)
        {
            AutomationElement found = null; string n = "", t = "";
            status = OnMta(delegate()
            {
                found = Find(Roots(wins), name, extra);
                if (found != null) { n = NameOf(found); t = TypeOf(found); }
            }, 60000);
            nm = n; ty = t;
            return found;
        }

        public static string Expand(Win[] wins, string name, List<AutomationElement> done)
        {
            string st, nm, ty;
            var e = FindMta(wins, name, new PropertyCondition(AutomationElement.IsExpandCollapsePatternAvailableProperty, true), out st, out nm, out ty);
            if (st != "ok") return "erreur|?|" + name + " (recherche : " + st + ")";
            if (e == null) return "introuvable";
            bool leaf = false;
            OnMta(delegate()
            {
                var p = (ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern);
                leaf = p.Current.ExpandCollapseState == ExpandCollapseState.LeafNode;
            }, 5000);
            if (leaf) return "feuille|" + ty + "|" + nm;
            done.Add(e);
            return Fmt(OnMta(delegate() { ((ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(); }, 3000), ty, nm);
        }

        public static string Collapse(List<AutomationElement> done)
        {
            var res = new List<string>();
            for (int i = done.Count - 1; i >= 0; i--)
            {
                var e = done[i];
                res.Add(OnMta(delegate()
                {
                    var p = (ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern);
                    if (p.Current.ExpandCollapseState != ExpandCollapseState.Collapsed) p.Collapse();
                }, 2000));
            }
            return string.Join(",", res.ToArray());
        }

        // Replie tous les menus ouverts de l'appli (après -KeepOpen). Les menus Win32 (#32768) qui résistent sont
        // fermés ensuite côté PowerShell par WM_CANCELMODE.
        public static string CollapseAll(Win[] wins)
        {
            int n = 0;
            string st = OnMta(delegate()
            {
                foreach (var r in Roots(wins))
                {
                    AutomationElementCollection all;
                    try
                    {
                        all = r.FindAll(TreeScope.Element | TreeScope.Descendants, new AndCondition(
                            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                            new PropertyCondition(AutomationElement.IsExpandCollapsePatternAvailableProperty, true)));
                    }
                    catch (Exception) { continue; }
                    foreach (AutomationElement e in all)
                    {
                        try
                        {
                            var p = (ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern);
                            if (p.Current.ExpandCollapseState == ExpandCollapseState.Expanded) { p.Collapse(); n++; }
                        }
                        catch (Exception) { }
                    }
                }
            }, 8000);
            return st + "|" + n;
        }

        public static string SelectTab(Win[] wins, string name)
        {
            string st, nm, ty;
            var e = FindMta(wins, name, new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
                new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true)), out st, out nm, out ty);
            if (st != "ok") return "erreur|?|" + name + " (recherche : " + st + ")";
            if (e == null) return "introuvable";
            return Fmt(OnMta(delegate() { ((SelectionItemPattern)e.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); }, 3000), ty, nm);
        }

        public static string InvokeDialog(Win[] wins, string name)
        {
            string st, nm, ty;
            Condition cond = new PropertyCondition(AutomationElement.IsInvokePatternAvailableProperty, true);
            bool menuOnly = MenuOnly.IsMatch(Norm(name));
            if (menuOnly) cond = new AndCondition(cond, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem));
            var e = FindMta(wins, name, cond, out st, out nm, out ty);
            if (st != "ok") return "erreur|?|" + name + " (recherche : " + st + ")";
            if (e == null) return menuOnly ? "introuvable-menu" : "introuvable";
            if (!SafeToInvoke(nm)) return "refus-nom|" + ty + "|" + nm;
            if (ty != "MenuItem" && ty != "Button" && ty != "SplitButton") return "refus-type|" + ty + "|" + nm;
            if (ty != "MenuItem" && MenuOnly.IsMatch(Norm(nm))) return "refus-bouton|" + ty + "|" + nm;
            return Fmt(OnMta(delegate() { ((InvokePattern)e.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); }, 3000), ty, nm);
        }
    }
}
'@

# Compilation mise en cache dans %TEMP%\copieur-universel (la compilation C# prend plusieurs secondes).
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
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
  $refs = @(
    [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.ControlType].Assembly.Location,
    [System.Windows.Rect].Assembly.Location
  )
  Import-Core $cs 'CopieurUniversel.Uia1.Dumper' 'uia_dump' $refs
} catch {
  Fail ('chargement d''UI Automation impossible : ' + $_.Exception.Message)
}

$dpiMode = [CopieurUniversel.Uia1.Win]::EnsureDpiAwareness()
$Q = { param($s) [CopieurUniversel.Uia1.Json]::Q([string]$s) }
$masker = New-Object CopieurUniversel.Uia1.Masker
$masker.Enabled = -not $NoMask

# ---------------------------------------------------------------------------------------------------------
# Choix de la fenêtre
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

$all = [CopieurUniversel.Uia1.Win]::TopWindows($true)

if ($ListWindows) {
  if (-not ($pn -or $ProcessId -or $WindowTitle)) {
    Fail '-ListWindows demande un filtre (-ProcessName, -ProcessId ou -WindowTitle) : on ne liste pas les fenêtres des autres applis de l''utilisateur.'
  }
  $ws = @($all | Where-Object { $_.Width -gt 0 -and $_.Height -gt 0 -and (Test-Win $_) })  # sans les fenêtres techniques de taille nulle
  $noProc = $false
  if ($ws.Count -eq 0) {
    $why = ''
    if ($ProcessId -and -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { $why = " (aucun processus avec le PID $ProcessId : terminé, ou lanceur ?)"; $noProc = $true }
    elseif ($pn -and -not (Get-Process -Name $pn -ErrorAction SilentlyContinue)) { $why = " (aucun processus « $pn »)"; $noProc = $true }
    Warn ("aucune fenêtre visible ne correspond au filtre$why. Une fenêtre lancée avec -WindowStyle Hidden ou Minimized reste cachée ou réduite.")
  }
  if ($noProc) { Write-Utf8 '[]'; exit 1 }
  $items = foreach ($w in $ws) { '  ' + $w.ToJson($masker, 0, 0) }
  $json = "[`n" + ($items -join ",`n") + "`n]"
  if ($Out) {
    $dir = Split-Path -Parent ([IO.Path]::GetFullPath($Out)); if ($dir) { [void](New-Item -ItemType Directory -Force -Path $dir) }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Out), $json, (New-Object Text.UTF8Encoding $false))
    Write-Utf8 ("OK uia_dump -ListWindows : {0} fenêtre(s) -> {1}" -f $ws.Count, $Out)
  } else { Write-Utf8 $json }
  exit 0
}

$target = $null
if ($Handle) {
  $h = [IntPtr]::Zero
  $hs = $Handle.Trim()
  if ($hs -match '^0x[0-9a-fA-F]+$') { $h = [IntPtr][Convert]::ToInt64($hs.Substring(2), 16) }
  elseif ($hs -match '^\d+$') { $h = [IntPtr][Int64]$hs }
  else { Fail "handle invalide : $Handle (décimal ou 0x…)" }
  if (-not [CopieurUniversel.Uia1.Native]::IsWindow($h)) { Fail "aucune fenêtre avec le handle $Handle" }
  $target = [CopieurUniversel.Uia1.Win]::Describe($h, 0)
} else {
  if (-not ($pn -or $ProcessId -or $WindowTitle)) { Fail 'précisez -ProcessName, -ProcessId, -WindowTitle ou -Handle (ou -ListWindows avec un filtre).' }
  $cands = @($all | Where-Object { -not $_.Cloaked -and $_.Width -gt 0 -and $_.Height -gt 0 -and (Test-Win $_) })
  if ($cands.Count -eq 0) {
    $hint = ''
    if ($pn -and (Get-Process -Name $pn -ErrorAction SilentlyContinue)) {
      $hint = " Le processus « $pn » existe mais n'a aucune fenêtre visible (fenêtre cachée, autre bureau virtuel, zone de notification ?)."
    } elseif ($pn) {
      $hint = " Aucun processus « $pn » : vérifier le nom (Get-Process), ou l'appli UWP hébergée par ApplicationFrameHost (essayer -WindowTitle)."
    }
    if ($ProcessId) {
      $pp = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if (-not $pp) { $hint += " Aucun processus avec le PID $ProcessId : il s'est terminé (lanceur, comme celui de Notepad ou Update.exe de Squirrel ?) ; retrouver le vrai processus par différence avant/après ou par sa ligne de commande." }
      else { $hint += " Le processus $ProcessId ($($pp.ProcessName)) n'a aucune fenêtre visible : fenêtre pas encore ouverte (attendre), cachée dans la zone de notification, ou affichée par un autre processus (lanceur, processus parent)." }
    }
    Fail ("aucune fenêtre visible ne correspond." + $hint)
  }
  $main = @($cands | Where-Object { $_.Owner -eq [IntPtr]::Zero -and $_.Title -ne '' -and -not $_.IsToolWindow })
  $pick = @(if ($WindowTitle -or $main.Count -eq 0) { $cands } else { $main })
  $target = $pick[0]
  if ($pick.Count -gt 1) {
    $lst = ($pick | Select-Object -First 6 | ForEach-Object { '{0} « {1} » ({2})' -f $_.Hex, $masker.Apply($_.Title), $_.Process }) -join ' ; '
    Warn ("{0} fenêtres correspondent ; utilisation de la première au premier plan : {1}. Préciser -WindowTitle ou -Handle si besoin. Candidates : {2}" -f $pick.Count, $target.Hex, $lst)
  }
}
if ($target.Minimized) { Warn 'la fenêtre est minimisée : rectangles peu fiables (window_shot.ps1 -Restore la restaure sans l''activer).' }

# Appli UWP : le cadre appartient à ApplicationFrameHost, partagé par TOUTES les applis UWP ouvertes ; on ne
# retient que le processus de l'appli elle-même (sinon on relèverait les fenêtres d'autres applis).
$procPids = @($(if ($target.AppPid) { $target.AppPid } else { $target.Pid }))
# Certaines applis (Bloc-notes de Windows 11, Explorateur…) ouvrent TOUTES leurs fenêtres dans un seul processus :
# une autre fenêtre principale du même PID peut être celle de l'utilisateur, avec ses documents. Actions et
# « autresFenetres » se limitent donc à la cible, à ce qu'elle possède (boîtes de dialogue, menus), aux
# fenêtres surgissantes, et aux fenêtres apparues pendant cet appel (boîte ouverte par -Invoke) ; -AllWindows
# lève cette limite pour le relevé seulement.
$preexisting = @($all | ForEach-Object { $_.Handle })
function Test-Related($w, [switch]$ForDump) {
  if ($w.Handle -eq $target.Handle -or $w.Owner -ne [IntPtr]::Zero) { return $true }
  if ($w.ClassName -eq '#32768' -or $w.ClassName -eq '#32770') { return $true }
  if ($w.IsPopup -or $w.IsToolWindow -or $w.Title -eq '') { return $true }
  if ($ForDump -and $AllWindows) { return $true }
  return ($preexisting -notcontains $w.Handle)
}
function Get-ProcWindows([switch]$ForDump) {
  $now = [CopieurUniversel.Uia1.Win]::TopWindows($true)
  $r = [CopieurUniversel.Uia1.Win[]]@($now | Where-Object {
      -not $_.Cloaked -and $_.Width -gt 0 -and
      (($procPids -contains $_.Pid) -or ($_.AppPid -and ($procPids -contains $_.AppPid)) -or $_.Owner -eq $target.Handle -or $_.Handle -eq $target.Handle) -and
      (Test-Related $_ -ForDump:$ForDump) })
  # La cible d'abord : une recherche par nom trouve son élément avant celui d'une autre fenêtre.
  $r = [CopieurUniversel.Uia1.Win[]]@(@($r | Where-Object { $_.Handle -eq $target.Handle }) + @($r | Where-Object { $_.Handle -ne $target.Handle }))
  return ,$r
}

# ---------------------------------------------------------------------------------------------------------
# Navigation prudente (facultative)
# ---------------------------------------------------------------------------------------------------------
$actions = New-Object System.Collections.Generic.List[string]
$actionFailed = $false
$expanded = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
function Add-Action([string]$label, [string]$res) {
  $parts = $res -split '\|', 3
  $status = $parts[0]
  $detail = $(if ($parts.Count -ge 3) { ' -> ' + $parts[1] + ' « ' + $masker.Apply($parts[2]) + ' »' } elseif ($parts.Count -eq 2) { ' : ' + $parts[1] } else { '' })
  $msg = switch ($status) {
    'ok'          { "$label : ok$detail" }
    'attente'     { "$label : lancé, sans réponse en 3 s (menu ou boîte modale Win32 : normal)$detail" }
    'introuvable' { $(if ($label -like 'CloseWindow*') { "$label : aucune boîte de dialogue ouverte de ce titre (voir -ListWindows)" } else { "$label : aucun élément de ce nom ne permet cette action (voir les Name et Patterns d'un relevé)" }) }
    'feuille'     { "$label : élément sans contenu à déplier$detail" }
    'introuvable-menu' { "$label : aucun élément de MENU de ce nom (pour ce nom, seul un MenuItem est activé : déplier d'abord le menu avec -Expand)" }
    'refus-nom'   { "$label : REFUSÉ - seuls les éléments qui ouvrent une boîte de dialogue ou une vue (nom en « … » ou liste blanche : Options, Paramètres, Propriétés, À propos, Mise en page…) peuvent être activés, et jamais Enregistrer, Ouvrir, Imprimer, Exporter, Supprimer, Envoyer, Quitter, Se déconnecter… même avec « … »$detail. Sinon : computer-use, ou décrire l'élément." }
    'refus-bouton' { "$label : REFUSÉ - ce nom n'est activé que dans un MENU : sur un bouton de boîte de dialogue, il exécuterait l'action (ex. « Remplacer » remplace le texte)$detail" }
    'refus-type'  { "$label : REFUSÉ - type non autorisé (MenuItem, Button, SplitButton seulement)$detail" }
    'refus'       { "$label : REFUSÉ$detail" }
    default       { "$label : échec$detail" }
  }
  if ($status -notin @('ok', 'attente')) { $script:actionFailed = $true; Warn $msg }
  $actions.Add($msg)
}

function Close-Win32Menus {
  # Un menu Win32 classique (#32768) ne se replie pas toujours par UI Automation : WM_CANCELMODE à sa fenêtre.
  $open = @(Get-ProcWindows | Where-Object { $_.ClassName -eq '#32768' })
  if ($open.Count -eq 0) { return 0 }
  [void][CopieurUniversel.Uia1.Native]::PostMessage($target.Handle, 0x001F, [IntPtr]::Zero, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 400
  return $open.Count
}
if ($CloseMenus) {
  $r = [CopieurUniversel.Uia1.Actions]::CollapseAll((Get-ProcWindows))
  $n32 = Close-Win32Menus
  $parts = $r -split '\|'
  $actions.Add(("CloseMenus : {0} menu(s) replié(s) par UI Automation, {1} menu(s) Win32 fermé(s) ({2})" -f $parts[-1], $n32, $parts[0]))
  Start-Sleep -Milliseconds $WaitMs
}
if ($CloseWindow) {
  $ws = Get-ProcWindows
  $cw = @($ws | Where-Object { $_.Handle -ne $target.Handle -and $_.Title.IndexOf($CloseWindow, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  $targetMatches = $target.Title.IndexOf($CloseWindow, [StringComparison]::OrdinalIgnoreCase) -ge 0
  if ($cw.Count -eq 0 -and $targetMatches -and $target.Owner -ne [IntPtr]::Zero) { $cw = @($target) }
  if ($cw.Count -eq 0 -and $targetMatches) {
    Add-Action "CloseWindow « $CloseWindow »" ('refus|c''est la fenêtre principale (' + $target.ClassName + ') : on ne la ferme jamais par cet outil (risque « Enregistrer ? ») ; fermer l''appli par son PID noté')
  }
  elseif ($cw.Count -eq 0) { Add-Action "CloseWindow « $CloseWindow »" 'introuvable' }
  else {
    $w = $cw[0]
    if ($w.Owner -eq [IntPtr]::Zero -and $w.ClassName -ne '#32770') {
      Add-Action "CloseWindow « $CloseWindow »" ('refus|fenêtre principale ou non possédée (' + $w.ClassName + ') : on ne ferme jamais une fenêtre principale (risque « Enregistrer ? »)')
    } else {
      [void][CopieurUniversel.Uia1.Native]::PostMessage($w.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      Start-Sleep -Milliseconds $WaitMs
      Add-Action "CloseWindow « $CloseWindow »" ('ok|Window|' + $w.Title)
      if ($w.Handle -eq $target.Handle) { Write-Utf8 'Boîte de dialogue fermée.'; exit 0 }
    }
  }
}
# Avec « powershell -File », -Expand "Affichage","Zoom" arrive en UNE chaîne « Affichage,Zoom » : on découpe.
$Expand = @($Expand | Where-Object { $_ } | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
# Sous-menus des fichiers récents : ils affichent les noms de fichiers (et dossiers) de l'UTILISATEUR. On ne les
# ouvre pas (décrire la flèche ›) ; -AllowRecent seulement quand la liste est fictive (profil temporaire, appli neuve).
# Recherche PARTOUT dans le nom (« Médias récents », « Recently Opened », « Documents récemment ouverts »…) ;
# « Recentrer » (re-centrer) n'est pas visé.
$recentRx = '\br[eé]ce(?:nt|nts|nte|ntes|ntly|mment)\b|\bhistor(?:ique|iques|y)\b|\bmru\b|^(?:r?ouvrir|reprendre)\b.*r[eé]cent|^reopen\b|^derni(?:er|ère)s?\s+(?:fichiers?|documents?|m[eé]dias?|projets?|dossiers?)'
foreach ($name in $Expand) {
  $clean = ($name -replace '&', '' -replace '(\.\.\.|…)$', '').Trim()
  if (-not $AllowRecent -and $clean -match $recentRx) {
    Add-Action "Expand « $name »" ('refus|sous-menu des fichiers récents : il afficherait les noms de fichiers de l''utilisateur (données personnelles). Le décrire (libellé, flèche ›) sans l''ouvrir ; -AllowRecent seulement si la liste est fictive (profil temporaire)')
    break
  }
  Add-Action "Expand « $name »" ([CopieurUniversel.Uia1.Actions]::Expand((Get-ProcWindows), $name, $expanded))
  Start-Sleep -Milliseconds $WaitMs
}
if ($SelectTab) {
  Add-Action "SelectTab « $SelectTab »" ([CopieurUniversel.Uia1.Actions]::SelectTab((Get-ProcWindows), $SelectTab))
  Start-Sleep -Milliseconds $WaitMs
}
if ($Invoke) {
  Add-Action "Invoke « $Invoke »" ([CopieurUniversel.Uia1.Actions]::InvokeDialog((Get-ProcWindows), $Invoke))
  Start-Sleep -Milliseconds ([Math]::Max($WaitMs, 1200))
}

# ---------------------------------------------------------------------------------------------------------
# Relevé
# ---------------------------------------------------------------------------------------------------------
$sw = [Diagnostics.Stopwatch]::StartNew()
$target = [CopieurUniversel.Uia1.Win]::Describe($target.Handle, $target.Z)  # position à jour
$d = New-Object CopieurUniversel.Uia1.Dumper($RawView.IsPresent)
$d.MaxDepth = [Math]::Max(0, $Depth); $d.MaxNodes = [Math]::Max(1, $MaxNodes)
$d.MaxItems = $MaxItems; $d.MaxListItems = $MaxListItems
$d.IncludeValues = $IncludeValues.IsPresent
$d.Mask = $masker
$d.OriginX = $target.Left; $d.OriginY = $target.Top
try { $tree = $d.DumpRootMta($target.Handle, '  ', 300000) } catch { Fail ('relevé UI Automation impossible : ' + $_.Exception.Message) }

$otherParts = New-Object System.Collections.Generic.List[string]
if ($AllWindows -or $actions.Count -gt 0) {
  foreach ($w in (Get-ProcWindows -ForDump)) {
    if ($w.Handle -eq $target.Handle) { continue }
    try {
      $t = $d.DumpRootMta($w.Handle, '      ', 300000)
      $otherParts.Add("    {`"fenetre`": " + $w.ToJson($masker, $target.Left, $target.Top) + ",`n     `"arbre`": " + $t + "}")
    } catch { Warn ('fenêtre ' + $w.Hex + ' ignorée : ' + $_.Exception.Message) }
  }
}
$sw.Stop()

if ($expanded.Count -gt 0 -and -not $KeepOpen) {
  $r = [CopieurUniversel.Uia1.Actions]::Collapse($expanded)
  $n32 = Close-Win32Menus
  $actions.Add("Repli après relevé : $r" + $(if ($n32) { " ; $n32 menu(s) Win32 fermé(s) par WM_CANCELMODE" } else { '' }))
}

$opts = '{"Depth": ' + $Depth + ', "MaxNodes": ' + $MaxNodes + ', "MaxItems": ' + $MaxItems + ', "MaxListItems": ' + $MaxListItems +
  ', "IncludeValues": ' + $(if ($IncludeValues) { 'true' } else { 'false' }) +
  ', "Masquage": ' + $(if ($NoMask) { 'false' } else { 'true' }) + ', "Vue": ' + $(if ($RawView) { '"Raw"' } else { '"Control"' }) +
  ', "AllWindows": ' + $(if ($AllWindows) { 'true' } else { 'false' }) + '}'
$act = '[' + (($actions | ForEach-Object { & $Q $_ }) -join ', ') + ']'
$stats = '{"noeuds": ' + $d.Nodes + ', "profondeurMax": ' + $d.Deepest + ', "tronque": ' + $(if ($d.Truncated) { 'true' } else { 'false' }) +
  ', "noeudsNonAffiches": ' + $d.NotShown + ', "elementsNonAffiches": ' + $d.ItemsNotShown + ', "erreurs": ' + $d.Errors +
  ', "masquages": ' + $masker.Count + ', "dureeMs": ' + $sw.ElapsedMilliseconds + '}'
$scale = $target.Scale
$json = "{`n" +
  "  `"outil`": " + (& $Q ("uia_dump.ps1 " + $script:Version)) + ",`n" +
  "  `"date`": " + (& $Q (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')) + ",`n" +
  "  `"dpi`": {`"processus`": " + (& $Q $dpiMode) + ", `"fenetre`": " + $target.Dpi + ", `"ecran`": " + $target.MonitorDpi + ", `"echelle`": " + [CopieurUniversel.Uia1.Json]::N($scale) + $(if ($target.StretchedByWindows) { ", `"agrandieParWindows`": true" } else { "" }) + "},`n" +
  "  `"origine`": " + (& $Q "BoundingRectangle et position : pixels physiques relatifs au coin haut-gauche du cadre visible de la fenêtre (même origine que window_shot.ps1) ; diviser par echelle pour obtenir des px CSS") + ",`n" +
  "  `"options`": " + $opts + ",`n" +
  "  `"fenetre`": " + $target.ToJson($masker, $target.Left, $target.Top) + ",`n" +
  "  `"actions`": " + $act + ",`n" +
  "  `"stats`": " + $stats + ",`n" +
  "  `"arbre`": " + $tree + ",`n" +
  "  `"autresFenetres`": [" + $(if ($otherParts.Count) { "`n" + ($otherParts -join ",`n") + "`n  " } else { '' }) + "]`n}"

if ($d.Truncated -and $Depth -gt 0) { Warn ("relevé tronqué ({0} nœud(s) non affiché(s)) : augmenter -Depth ou -MaxNodes, ou viser une sous-fenêtre." -f $d.NotShown) }
if ($d.ItemsNotShown -gt 0) { Write-Utf8 ("note : {0} ligne(s)/élément(s) de liste au-delà de -MaxItems {1} / -MaxListItems {2} non relevés (la structure suffit, les données seront fictives)" -f $d.ItemsNotShown, $MaxItems, $MaxListItems) -Err }
if ($Out) {
  $full = [IO.Path]::GetFullPath($Out)
  $dir = Split-Path -Parent $full
  if ($dir) { [void](New-Item -ItemType Directory -Force -Path $dir) }
  [IO.File]::WriteAllText($full, $json, (New-Object Text.UTF8Encoding $false))
  Write-Utf8 ("OK uia_dump : {0} nœuds (profondeur {1}) -> {2} ; fenêtre « {3} » ({4}, PID {5}, {6}) ; échelle {7} ; {8} autre(s) fenêtre(s) ; {9} masquage(s) ; {10} ms" -f `
      $d.Nodes, $d.Deepest, $full, $masker.Apply($target.Title), $target.Process, $target.Pid, $target.Hex, $scale, $otherParts.Count, $masker.Count, $sw.ElapsedMilliseconds)
  foreach ($a in $actions) { Write-Utf8 ('  action : ' + $a) }
} else {
  Write-Utf8 $json
}
if ($actionFailed) { exit 2 }
exit 0
