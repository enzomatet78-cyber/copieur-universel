/*
 * tailwind-config.js — configuration Tailwind (Play CDN v3) partagée par toutes les pages du clone.
 * Plugin copieur-universel, skill reconstruire-appli. À copier dans <CLONE>/assets/tailwind-config.js.
 *
 * Chargement, dans <head>, dans CET ordre :
 *   <script src="https://cdn.tailwindcss.com/3.4.16?plugins=forms"></script>   (forms : seulement si l'original
 *   <script src="/assets/tailwind-config.js"></script>                           stylise radios/cases/champs)
 *
 * Comment le remplir (à partir de la capture : styles.css produit par __styles() du kit) :
 *  1. Police : section « 4. Polices » / « Polices : … » → fontFamily.sans (et la balise Google Fonts du gabarit).
 *  2. Palette : section « 6. Classes de couleur → valeur calculée ». Pour chaque classe (bg-blue-600 = rgb(…)),
 *     comparer avec la palette Tailwind v3 par défaut (extrait ci-dessous). Si toutes concordent : ne rien
 *     ajouter. Sinon : redéfinir la teinte concernée dans colors (ex. blue: { 600: '#1d4ed8' }) — extend fusionne
 *     teinte par teinte, les autres nuances restent celles par défaut.
 *  3. Couleurs nommées propres à l'appli (classes bg-primary, text-brand-500, border-stroke…) : les déclarer
 *     dans colors avec la valeur calculée relevée.
 *  4. Variables CSS (section 3) : si l'original définit ses couleurs par variables (--primary: …) et des
 *     classes comme bg-[var(--primary)], recopier les variables dans assets/shell.css (:root { … }).
 *  5. Échelles personnalisées (fontSize, borderRadius, boxShadow, spacing, screens) : seulement si une classe
 *     du DOM n'existe pas dans Tailwind par défaut ou donne une autre valeur calculée.
 * Vérification : script « contrôle de palette » de references/fidelite.md, lancé dans le clone.
 *
 * Original en Tailwind v4 (styles.css indique « Tailwind : v4 probable », couleurs en oklch(…)) : NE PAS
 * utiliser ce fichier ; charger https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4 et déclarer le thème dans
 * <style type="text/tailwindcss">@theme { --font-sans: …; --color-primary: …; }</style> (voir fidelite.md).
 *
 * Palette v3 par défaut (rappel, pour comparer vite) :
 *   gray   50 #f9fafb 100 #f3f4f6 200 #e5e7eb 300 #d1d5db 400 #9ca3af 500 #6b7280 600 #4b5563 700 #374151 800 #1f2937 900 #111827
 *   slate  50 #f8fafc 100 #f1f5f9 200 #e2e8f0 300 #cbd5e1 400 #94a3b8 500 #64748b 600 #475569 700 #334155 800 #1e293b 900 #0f172a
 *   blue   50 #eff6ff 100 #dbeafe 200 #bfdbfe 300 #93c5fd 400 #60a5fa 500 #3b82f6 600 #2563eb 700 #1d4ed8 800 #1e40af 900 #1e3a8a
 *   indigo 50 #eef2ff 100 #e0e7ff 500 #6366f1 600 #4f46e5 700 #4338ca
 *   green  50 #f0fdf4 100 #dcfce7 500 #22c55e 600 #16a34a 700 #15803d
 *   red    50 #fef2f2 100 #fee2e2 500 #ef4444 600 #dc2626 700 #b91c1c
 *   amber  50 #fffbeb 100 #fef3c7 500 #f59e0b 600 #d97706     yellow 400 #facc15 500 #eab308
 */
(function () {
  'use strict';
  if (typeof window.tailwind === 'undefined') {
    // CDN Tailwind non chargé (hors ligne ?) : la page reste lisible, sans les utilitaires
    if (window.console) console.warn('[tailwind-config] Tailwind Play CDN absent : vérifier la balise <script> du <head>');
    return;
  }
  window.tailwind.config = {
    // darkMode: 'class',            // seulement si l'original bascule en sombre avec une classe sur <html>
    theme: {
      extend: {
        fontFamily: {
          // Police principale de l'original (relevée dans styles.css) ; garder des replis réalistes
          sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
        },
        colors: {
          // Exemples — à remplacer par les valeurs RELEVÉES (ne jamais deviner une couleur) :
          // primary: { DEFAULT: '#2563eb', 50: '#eff6ff', 600: '#2563eb', 700: '#1d4ed8' },
          // brand: '#0236c2',
        }
        // fontSize: { '2xs': ['10px', '14px'] },
        // borderRadius: { '2.5xl': '20px' },
        // boxShadow: { card: '0 1px 2px rgba(16, 24, 40, 0.05)' },
      }
    }
    // corePlugins: { preflight: false },  // seulement si l'original n'utilise PAS le reset de Tailwind
  };
})();
