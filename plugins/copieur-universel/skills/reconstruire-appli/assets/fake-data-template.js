/*
 * fake-data.js — données FICTIVES partagées par les pages du clone (plugin copieur-universel,
 * skill reconstruire-appli). À copier dans <CLONE>/assets/fake-data.js puis à adapter (section « À ADAPTER »).
 *
 * Principes :
 *  - Aucune donnée réelle de tiers (clients, contacts, membres, messages…) : tout est inventé ici.
 *  - DÉTERMINISTE : mêmes valeurs à chaque chargement (générateur à graine fixe, « aujourd'hui » figé).
 *    Jamais Math.random() ni new Date() sans argument dans les pages : les vérifications comparent des
 *    mesures et des textes d'un chargement à l'autre.
 *  - Ce que l'utilisateur a choisi de GARDER (titulaire du compte, son organisation, réglages propres au
 *    compte, chiffres agrégés) se renseigne dans OWNER et dans les jeux de données de la page concernée.
 *  - Emails fictifs : domaines exemple.com / exemple.fr / exemple.org, admis par scan_pii.py avec
 *    --allow-domain "exemple.*" (seuls les domaines réservés example.com/.org/.net le sont d'office).
 *    Téléphones fictifs : +33 6 39 98 xx xx, plage réservée aux œuvres de fiction (ARCEP).
 *  - Secrets (clés API, jetons, cartes, IBAN) : jamais de valeur réelle → FAKE.masked('sk_live_', r).
 *
 * API (window.FAKE) :
 *   TODAY                      Date figée (date de la capture de l'original)
 *   rng(seed) → r()            générateur [0,1) ; seed nombre ou chaîne (FAKE.rng('contacts'))
 *   hash(texte) → entier       graine stable à partir d'un texte
 *   pick(r, liste), int(r, min, max), float(r, min, max, déc), chance(r, p), shuffle(r, liste), sample(r, liste, n)
 *   person(r) → { firstName, lastName, name, initials, email, phone, city, country, countryCode }
 *   people(n, graine), company(r), address(r), sentence(r), title(r), hex(r, n), id(r, préfixe, n), uuid(r)
 *   email(prénom, nom, r), phone(r), phoneNational(r), masked(préfixe, r, n), slug(texte), initials(nom)
 *   date(r, joursAvant, joursAprès), daysAgo(n, h, min), addDays(d, n), iso(d)
 *   money(r, min, max, pas), series(r, n, { min, max, start, trend, noise, decimals }), split(r, total, parts)
 *   avatarColor(nom, palette)
 *   OWNER, members, contacts   (exemples de jeux partagés, à adapter aux colonnes capturées)
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------------------- *
   * À ADAPTER
   * ---------------------------------------------------------------------------------- */
  // « Aujourd'hui » figé : la date (et l'heure) de la capture de l'original
  var TODAY = new Date('2026-10-12T10:00:00');

  // Titulaire du compte : fictif par défaut ; ne mettre les vraies valeurs que si l'utilisateur l'a demandé
  var OWNER = {
    id: 'u0', firstName: 'Camille', lastName: 'Martin', name: 'Camille Martin',
    email: 'camille.martin@exemple.com', role: 'Admin', owner: true,
    org: 'Atelier Exemple'
  };

  /* ---------------------------------------------------------------------------------- *
   * Générateur déterministe (mulberry32) et utilitaires
   * ---------------------------------------------------------------------------------- */
  function hash(s) { // FNV-1a 32 bits
    var h = 2166136261; s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = (typeof seed === 'number' ? seed : hash(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function int(r, min, max) { return min + Math.floor(r() * (max - min + 1)); }
  function float(r, min, max, dec) { var v = min + r() * (max - min); var p = Math.pow(10, dec == null ? 2 : dec); return Math.round(v * p) / p; }
  function chance(r, p) { return r() < p; }
  function shuffle(r, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function sample(r, arr, n) { return shuffle(r, arr).slice(0, n); }
  function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, ''); }
  function initials(name) { return String(name).trim().split(/\s+/).map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  /* ---------------------------------------------------------------------------------- *
   * Dates (toujours relatives à TODAY)
   * ---------------------------------------------------------------------------------- */
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function daysAgo(n, h, min) {
    var x = addDays(TODAY, -n);
    if (h != null) x.setHours(h, min || 0, 0, 0);
    return x;
  }
  /* date(r, 30) : dans les 30 derniers jours ; date(r, 0, 14) : dans les 14 prochains jours ; arrondi au quart d'heure */
  function date(r, daysBack, daysFwd) {
    var span = (daysBack || 0) + (daysFwd || 0);
    var d = new Date(TODAY.getTime() + Math.floor((r() * span - (daysBack || 0)) * 86400000));
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    return d;
  }
  function iso(d) { return d.toISOString(); }

  /* ---------------------------------------------------------------------------------- *
   * Personnes, organisations, textes
   * ---------------------------------------------------------------------------------- */
  var FIRST = ['Lucas', 'Emma', 'Hugo', 'Chloé', 'Louis', 'Léa', 'Gabriel', 'Manon', 'Arthur', 'Camille', 'Jules', 'Sarah', 'Nathan', 'Inès', 'Théo', 'Julie', 'Raphaël', 'Clara', 'Paul', 'Zoé', 'Adam', 'Alice', 'Tom', 'Lina', 'Maxime', 'Anaïs', 'Antoine', 'Pauline', 'Victor', 'Margaux', 'Thomas', 'Océane', 'Alexandre', 'Mélanie', 'Nicolas', 'Laura', 'Julien', 'Élodie', 'Romain', 'Audrey'];
  var LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guérin', 'Muller', 'Henry', 'Roussel', 'Perrin', 'Morin'];
  var DOMAINS = ['exemple.com', 'exemple.fr', 'exemple.org'];
  var PLACES = [['Paris', 'France', 'FR', '75011'], ['Lyon', 'France', 'FR', '69003'], ['Marseille', 'France', 'FR', '13006'], ['Bordeaux', 'France', 'FR', '33000'], ['Lille', 'France', 'FR', '59000'], ['Nantes', 'France', 'FR', '44000'], ['Toulouse', 'France', 'FR', '31000'], ['Rennes', 'France', 'FR', '35000'], ['Strasbourg', 'France', 'FR', '67000'], ['Bruxelles', 'Belgique', 'BE', '1000'], ['Genève', 'Suisse', 'CH', '1201'], ['Montréal', 'Canada', 'CA', 'H2X 1Y4'], ['Luxembourg', 'Luxembourg', 'LU', 'L-1111']];
  var STREETS = ['rue des Lilas', 'avenue des Tilleuls', 'boulevard du Parc', 'rue de la Fontaine', 'place du Marché', 'chemin des Vignes', 'rue du Moulin', 'allée des Cerisiers'];
  var CO_A = ['Atelier', 'Studio', 'Maison', 'Cabinet', 'Agence', 'Collectif', 'Comptoir', 'Bureau'];
  var CO_B = ['Boréal', 'Horizon', 'Lumen', 'Azur', 'Céleste', 'Archipel', 'Sillage', 'Mistral', 'Galet', 'Ondine', 'Opale', 'Sémaphore'];
  var SENTENCES = [
    'Merci pour votre retour, je reviens vers vous rapidement.',
    'Pouvons-nous décaler le rendez-vous à jeudi ?',
    'Le document est prêt, je vous l’envoie dans la journée.',
    'Bonne nouvelle : la proposition a été validée.',
    'Je n’ai pas reçu la confirmation, pouvez-vous vérifier ?',
    'Voici le récapitulatif de notre échange de ce matin.',
    'Nous avons bien noté votre demande.',
    'Rappel : la réunion commence à 14 h.',
    'Pourriez-vous compléter le formulaire avant vendredi ?',
    'Le paiement a bien été enregistré, merci.'
  ];
  var TITLES = ['Point hebdomadaire', 'Rendez-vous découverte', 'Suivi de dossier', 'Présentation de l’offre', 'Appel de qualification', 'Revue trimestrielle', 'Atelier de lancement', 'Démonstration produit'];

  function email(first, last, r) {
    return slug(first) + '.' + slug(last) + (r && chance(r, 0.3) ? int(r, 1, 99) : '') + '@' + (r ? pick(r, DOMAINS) : DOMAINS[0]);
  }
  function phone(r) { return '+33 6 39 98 ' + pad(int(r, 0, 99), 2) + ' ' + pad(int(r, 0, 99), 2); }
  function phoneNational(r) { return '06 39 98 ' + pad(int(r, 0, 99), 2) + ' ' + pad(int(r, 0, 99), 2); }
  function person(r) {
    var f = pick(r, FIRST), l = pick(r, LAST), p = pick(r, PLACES);
    return {
      firstName: f, lastName: l, name: f + ' ' + l, initials: initials(f + ' ' + l),
      email: email(f, l, r), phone: phone(r), city: p[0], country: p[1], countryCode: p[2]
    };
  }
  function people(n, seed) { var r = rng(seed == null ? 'people' : seed), out = []; for (var i = 0; i < n; i++) out.push(person(r)); return out; }
  function company(r) { return pick(r, CO_A) + ' ' + pick(r, CO_B); }
  function address(r) { var p = pick(r, PLACES); return int(r, 1, 120) + ' ' + pick(r, STREETS) + ', ' + p[3] + ' ' + p[0]; }
  function sentence(r) { return pick(r, SENTENCES); }
  function title(r) { return pick(r, TITLES); }
  function hex(r, n) { var s = ''; for (var i = 0; i < n; i++) s += Math.floor(r() * 16).toString(16); return s; }
  function id(r, prefix, n) { return (prefix || '') + hex(r, n || 24); }
  function uuid(r) { var h = hex(r, 32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' + ((parseInt(h.charAt(16), 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32); }
  /* masked('sk_live_', r) → 'sk_live_••••••••3f9a' : aspect d'un secret, sans secret */
  function masked(prefix, r, n) { return (prefix || '') + '••••••••' + hex(r, n || 4); }

  /* ---------------------------------------------------------------------------------- *
   * Nombres et séries (graphiques)
   * ---------------------------------------------------------------------------------- */
  function money(r, min, max, step) { step = step || 1; return Math.round((min + r() * (max - min)) / step) * step; }
  /* series(r, 12, { min: 0, max: 100, start: 40, trend: 2, noise: 8, decimals: 0 }) → 12 valeurs bornées */
  function series(r, n, o) {
    o = o || {};
    var min = o.min == null ? 0 : o.min, max = o.max == null ? 100 : o.max, v = o.start == null ? (min + max) / 2 : o.start;
    var p = Math.pow(10, o.decimals || 0), out = [];
    for (var i = 0; i < n; i++) {
      v += (o.trend || 0) + (r() * 2 - 1) * (o.noise == null ? (max - min) / 10 : o.noise);
      v = Math.max(min, Math.min(max, v));
      out.push(Math.round(v * p) / p);
    }
    return out;
  }
  /* split(r, 100, 4) → 4 entiers ≥ 0 dont la somme vaut exactement 100 (parts de donut, répartitions) */
  function split(r, total, parts) {
    var w = [], s = 0, out = [], acc = 0;
    for (var i = 0; i < parts; i++) { var x = 0.2 + r(); w.push(x); s += x; }
    for (var j = 0; j < parts; j++) {
      var v = j === parts - 1 ? total - acc : Math.floor(total * w[j] / s);
      out.push(v); acc += v;
    }
    return out;
  }
  var AVATAR = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#ca8a04'];
  function avatarColor(name, palette) { var p = palette || AVATAR; return p[hash(name) % p.length]; }

  /* ---------------------------------------------------------------------------------- *
   * Jeux de données partagés — EXEMPLES à adapter (colonnes, effectifs, valeurs possibles relevées
   * dans la capture : noms exacts des étapes, sources, rôles…)
   * ---------------------------------------------------------------------------------- */
  var ROLES = ['Membre', 'Membre', 'Gestionnaire', 'Membre', 'Admin'];
  var members = [OWNER];
  var rm = rng('members');
  for (var i = 1; i <= 11; i++) {
    var pm = person(rm);
    members.push({ id: 'u' + i, firstName: pm.firstName, lastName: pm.lastName, name: pm.name, initials: pm.initials, email: pm.email, phone: pm.phone, role: pick(rm, ROLES), owner: false });
  }

  var STAGES = ['Nouveau', 'Contacté', 'Qualifié', 'Proposition', 'Gagné', 'Perdu'];
  var SOURCES = ['Site web', 'Recommandation', 'Réseaux sociaux', 'Publicité', 'Salon', 'Autre'];
  var contacts = [];
  var rc = rng('contacts');
  for (var j = 0; j < 120; j++) {
    var pc = person(rc);
    contacts.push({
      id: 'c' + (1000 + j), firstName: pc.firstName, lastName: pc.lastName, name: pc.name, initials: pc.initials,
      email: pc.email, phone: pc.phone, city: pc.city, country: pc.country, countryCode: pc.countryCode,
      company: company(rc), stage: pick(rc, STAGES), source: pick(rc, SOURCES),
      owner: members[int(rc, 0, members.length - 1)].id,
      createdAt: iso(date(rc, 120)), value: pick(rc, [0, 0, 500, 1200, 2500, 4000, 7500, 12000])
    });
  }

  window.FAKE = {
    TODAY: TODAY, OWNER: OWNER,
    rng: rng, hash: hash, pick: pick, int: int, float: float, chance: chance, shuffle: shuffle, sample: sample,
    slug: slug, initials: initials,
    addDays: addDays, daysAgo: daysAgo, date: date, iso: iso,
    person: person, people: people, company: company, address: address, sentence: sentence, title: title,
    email: email, phone: phone, phoneNational: phoneNational, hex: hex, id: id, uuid: uuid, masked: masked,
    money: money, series: series, split: split, avatarColor: avatarColor,
    FIRST: FIRST, LAST: LAST, DOMAINS: DOMAINS,
    members: members, contacts: contacts, stages: STAGES, sources: SOURCES,
    memberById: function (mid) { for (var k = 0; k < members.length; k++) if (members[k].id === mid) return members[k]; return null; }
  };
})();
