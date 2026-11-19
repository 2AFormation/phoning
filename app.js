// 2A Phoning : application d'appels partagée (Antoine, Alexandre, Sybille).
// Données : Supabase (connexion obligatoire, règles d'accès côté base). Aucune donnée dans ce dépôt.
(function () {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = new Date(); const today = iso(TODAY);
const fr = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const monday = (() => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); })();
let ls = {}; try { ls = JSON.parse(localStorage.getItem('phoning2a') || '{}'); } catch (e) {}
const save = () => { try { localStorage.setItem('phoning2a', JSON.stringify(ls)); } catch (e) {} };
let toastT; function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => e.hidden = true, 2600); }
function status(t) { const s = $('status'); s.textContent = t || ''; s.hidden = !t; }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const CFG = window.APP_CONFIG || {};
if (!window.supabase || !CFG.supabaseUrl || CFG.supabaseUrl === 'A_REMPLACER') {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Application pas encore configurée (adresse du projet Supabase manquante).</p>';
  return;
}
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

// ---------- connexion
let started = false, recovering = /type=(recovery|invite)/.test(location.hash);
function showLogin(msg) { $('appZone').hidden = true; $('loginZone').hidden = false; $('loginMsg').textContent = msg || ''; }
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginMsg').textContent = 'Connexion…';
  const { error } = await sb.auth.signInWithPassword({ email: $('lEmail').value.trim(), password: $('lPass').value });
  if (error) $('loginMsg').textContent = 'Adresse ou mot de passe incorrect.';
});
$('forgot').addEventListener('click', async () => {
  const email = $('lEmail').value.trim();
  if (!email) { $('loginMsg').textContent = 'Saisissez d’abord votre adresse mail.'; return; }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $('loginMsg').textContent = 'Si cette adresse est autorisée, un mail pour choisir un nouveau mot de passe vient de partir.';
});
$('newPassForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $('nPass').value });
  if (error) { $('loginMsg').textContent = 'Mot de passe refusé : ' + error.message; return; }
  recovering = false; history.replaceState(null, '', location.pathname + '#accueil'); toast('Mot de passe enregistré'); boot();
});
$('logout').addEventListener('click', async () => { await sb.auth.signOut(); location.hash = ''; showLogin('Vous êtes déconnecté.'); });
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY') recovering = true;
  if (recovering && session) { $('appZone').hidden = true; $('loginZone').hidden = false; $('loginForm').hidden = true; $('newPassForm').hidden = false; return; }
  if (session && !started) boot(); else if (!session) { started = false; showLogin(); }
});

// ---------- données
const C = {}; let ALL = [], A = {}, MEMBRES = {}, me = { email: '', prenom: '' }, CLI = [], INFOS = {};
let NUM = {}, NUM_OK = false, findMode = false;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- enregistrements fiables : si le réseau tombe en plein appel, la saisie est gardée sur l'appareil et renvoyée dès le retour
const isNet = e => !e || navigator.onLine === false || /fetch|network|timeout|failed|load failed|abort/i.test(e.message || '');
let flushing = false;
const pending = () => (ls.outbox || []).length;
function syncChip() { const s = $('sync'); if (!s) return; const n = pending(); s.hidden = !n; s.textContent = n + ' en attente d’envoi'; }
async function run(job) {
  const q = sb.from(job.table);
  const { error } = job.op === 'delete' ? await q.delete().eq(job.key, job.val) : await q.upsert(job.row);
  return error;
}
function enqueue(job) { ls.outbox = ls.outbox || []; ls.outbox.push(job); save(); syncChip(); }
async function send(job) {
  if (pending()) { enqueue(job); flush(); return { queued: true }; }
  let err = null; try { err = await run(job); } catch (e) { err = e; }
  if (!err) return { ok: true };
  if (isNet(err)) { enqueue(job); return { queued: true }; }
  return { error: err };
}
async function flush() {
  if (flushing || !pending()) return; flushing = true;
  try {
    while (pending()) {
      const job = ls.outbox[0]; let err = null; try { err = await run(job); } catch (e) { err = e; }
      if (err && isNet(err)) break;
      ls.outbox.shift(); save();
      if (err) toast('Un enregistrement en attente a été refusé par la base.');
    }
  } finally { flushing = false; syncChip(); }
}
addEventListener('online', flush); setInterval(flush, 20000);
const RES = {
  R: [['Joint – intéressé (RDV)', 'g'], ['Joint – à rappeler', 'w'], ['Message laissé', 'n'], ['Transmis au standard', 'n'], ['Pas intéressé', 'b'], ['Ne plus contacter', 'b'], ['Mauvais numéro', 'b'], ['Injoignable', 'n']],
  S: [['Adresse mail obtenue', 'g'], ['Joint – intéressé (RDV)', 'g'], ['Joint – à rappeler', 'w'], ['Message laissé', 'n'], ['Transmis au standard', 'n'], ['Pas intéressé', 'b'], ['Ne plus contacter', 'b'], ['Mauvais numéro', 'b'], ['Injoignable', 'n']] };
const NEEDDATE = ['Joint – intéressé (RDV)', 'Joint – à rappeler'];
const RETRY = ['Message laissé', 'Injoignable', 'Transmis au standard'];
function fromRow(r) { return { maj: r.maj || '', res: r.resultat, date: r.date_appel, pers: r.personne || '', note: r.note || '', suite: r.suite || '', rappel: r.rappel || '', mail: r.mail_obtenu || '', par: r.par || '', hist: r.hist || [] }; }
function toRow(id, a) { return { etab_id: id, resultat: a.res, date_appel: a.date, personne: a.pers, note: a.note, suite: a.suite || '', rappel: a.rappel || null, mail_obtenu: a.mail || '', par: a.par, hist: a.hist || [], maj: new Date().toISOString() }; }
async function fetchAll(table, order) {
  const out = []; let from = 0;
  for (;;) { const { data, error } = await sb.from(table).select('*').order(order).range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}
const nom = p => (MEMBRES[(p || '').toLowerCase()] || p || 'Quelqu’un');
function done(c) { const a = A[c.id]; if (!a) return false; if (a.rappel && a.rappel <= today) return false; if (RETRY.includes(a.res) && a.date && a.date <= addDays(-7)) return false; return true; }
function toCall(c) { return c.tel && !done(c); }
function applyNum(c) { const n = NUM[c.id]; c.tel = (n && n.tel) ? n.tel : c.tel0; c.intr = !!(n && n.introuvable && !c.tel); }
async function loadNumeros() {
  try { const r = await fetchAll('etab_tel', 'etab_id'); NUM = {}; r.forEach(x => { NUM[x.etab_id] = x; }); NUM_OK = true; ALL.forEach(applyNum); }
  catch (e) { NUM_OK = false; } // table pas encore créée : le reste de l'appli fonctionne normalement
}
const searchUrl = c => 'https://www.google.com/search?q=' + encodeURIComponent(c.nom + ' ' + (c.ville || '') + ' ' + (NAMES[c.dep] || c.dep) + ' téléphone');
async function saveNum(c, tel, introuvable) {
  tel = (tel || '').trim();
  if (!NUM_OK) { toast('L’enregistrement des numéros n’est pas encore activé.'); return false; }
  if (!introuvable && !/^[0-9+().\s-]{8,}$/.test(tel)) { toast('Numéro incomplet : vérifiez-le.'); return false; }
  const row = { etab_id: c.id, tel: introuvable ? '' : tel, introuvable: !!introuvable, par: me.email, maj: new Date().toISOString() };
  const r = await send({ table: 'etab_tel', op: 'upsert', row });
  if (r.error) { toast('Enregistrement impossible pour le moment : réessayez dans un instant.'); return false; }
  NUM[c.id] = row; applyNum(c); toast(r.queued ? 'Hors connexion : numéro gardé, envoi dès le retour du réseau' : introuvable ? 'Noté : introuvable' : 'Numéro enregistré'); return true;
}

async function boot() {
  started = true; $('loginZone').hidden = true; $('appZone').hidden = false; status('Chargement des données…');
  try {
    const { data: { user } } = await sb.auth.getUser(); me.email = (user && user.email || '').toLowerCase();
    const [mem, etab, app, cli, inf] = await Promise.all([fetchAll('membres', 'email'), fetchAll('etablissements', 'id'), fetchAll('appels', 'etab_id'), fetchAll('clients', 'ordre'), fetchAll('infos', 'cle')]);
    if (!mem.length) { status(''); showLogin('Cette adresse n’est pas autorisée. Demandez à Alexandre de l’ajouter.'); await sb.auth.signOut(); return; }
    mem.forEach(m => MEMBRES[m.email.toLowerCase()] = m.prenom); me.prenom = MEMBRES[me.email] || '';
    etab.forEach(e => C[e.id] = { id: e.id, k: e.genre, reg: e.region || 'Non précisé', dep: e.dep || '', nom: e.nom, qui: e.interlocuteur || '', tel: e.tel || '', tel0: e.tel || '', intr: false, mail: e.email || '', env: e.date_mail || '', ech: !!e.mail_en_echec, type: e.type || '', gest: e.gestionnaire || '', ville: e.ville || '', asso: e.asso_contactee || '' });
    ALL = Object.values(C); A = {}; app.forEach(r => A[r.etab_id] = fromRow(r));
    CLI = cli; inf.forEach(i => INFOS[i.cle] = i.valeur);
    await loadNumeros(); await loadCampagne(); await loadTravail(); syncChip(); flush();
    status(''); initViews(); route();
    sb.channel('appels').on('postgres_changes', { event: '*', schema: 'public', table: 'appels' }, p => {
      if (p.eventType === 'DELETE') delete A[p.old.etab_id]; else A[p.new.etab_id] = fromRow(p.new);
      refreshCurrent();
    }).subscribe();
    watchTravail();
    if (NUM_OK) sb.channel('etab_tel').on('postgres_changes', { event: '*', schema: 'public', table: 'etab_tel' }, p => {
      const id = (p.eventType === 'DELETE' ? p.old : p.new).etab_id; if (p.eventType === 'DELETE') delete NUM[id]; else NUM[id] = p.new;
      if (C[id]) applyNum(C[id]); refreshCurrent();
    }).subscribe();
    if (CAMP_OK) sb.channel('campagne_appels').on('postgres_changes', { event: '*', schema: 'public', table: 'campagne_appels' }, p => {
      if (p.eventType === 'DELETE') delete KA[p.old.cible_id]; else KA[p.new.cible_id] = kFromRow(p.new);
      refreshCurrent();
    }).subscribe();
  } catch (e) { status('Les données ne peuvent pas être chargées pour le moment. Vérifiez la connexion internet puis rechargez la page.'); }
}

// ---------- vues
const VIEWS = ['accueil', 'seance', 'campagne', 'carte', 'bilan', 'clients', 'taches', 'formations', 'notes'];
const GROUP = { campagne: 'seance', carte: 'seance', bilan: 'seance' };
const curView = () => VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'accueil';
function route() {
  if (!ALL.length) return;
  const v = curView();
  document.querySelectorAll('[data-view]').forEach(s => s.hidden = s.dataset.view !== v);
  document.querySelectorAll('nav a').forEach(a => { if (a.dataset.v === (GROUP[v] || v)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('subnav').hidden = !(v === 'seance' || GROUP[v]);
  document.querySelectorAll('#subnav a').forEach(a => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (v !== 'taches') tNew.clear();
  if (v === 'carte') drawMap(); if (v === 'accueil') renderMonJour(); if (v === 'bilan') renderBilan(); if (v === 'campagne') renderCampagne();
  if (v === 'taches') renderTaches(); if (v === 'clients') renderClients(); if (v === 'formations') renderFormations(); if (v === 'notes') renderNotes();
  updateBadge(); window.scrollTo(0, 0);
}
addEventListener('hashchange', () => { if (!recovering) route(); });
function refreshCurrent() { const v = curView(); updateBadge(); if (v === 'accueil') renderMonJour(); if (v === 'bilan') renderBilan(); if (v === 'carte') drawMap(); if (v === 'seance' && !Q.length) poolInfo(); if (v === 'campagne' && !kOpen) renderCampagne(); if (v === 'taches' && !tOpen) renderTaches(); if (v === 'clients' && cOpen === null) renderClients(); if (v === 'formations' && !fOpen) renderFormations(); if (v === 'notes') renderNotes(); }

// ---------- accueil
const sess = { n: 0 };
function allCalls() { // appels de la séance et de la campagne dans une même liste
  const out = [];
  Object.entries(A).forEach(([id, a]) => { const c = C[id]; if (c) out.push({ src: 'S', id, c, a, nom: c.nom, dep: c.dep }); });
  Object.entries(KA).forEach(([id, a]) => { const c = KC[id]; if (c) out.push({ src: 'K', id, c, a, nom: c.nom, dep: c.dep }); });
  return out;
}
const isMine = a => (a.par || '').toLowerCase() === me.email;
const mineToday = () => allCalls().filter(x => x.a.date === today && isMine(x.a)).length;
const depTxt = d => NAMES[d] ? d + ' – ' + NAMES[d] : d;
const openBtn = x => '<button ' + (x.src === 'K' ? 'data-kopen' : 'data-open') + '="' + esc(x.id) + '">Ouvrir la fiche</button>';
function renderBilan() {
  $('today').textContent = TODAY.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('hello').textContent = 'Bilan des appels';
  const calls = allCalls(), day = calls.filter(x => x.a.date === today), mine = day.filter(x => isMine(x.a));
  const goal = +(ls.goal || 150);
  $('goalSel').innerHTML = [...new Set([20, 50, 100, 150, 200, goal])].sort((x, y) => x - y).map(n => '<option>' + n + '</option>').join(''); $('goalSel').value = String(goal);
  $('goalTxt').textContent = mine.length + ' appel' + (mine.length > 1 ? 's' : '') + ' sur ' + goal + ' aujourd’hui' + (mine.length >= goal ? ' : objectif atteint, bravo.' : '') + (day.length > mine.length ? ' · toute l’équipe : ' + day.length : '');
  $('gaugeBar').style.width = Math.min(100, mine.length / goal * 100) + '%';
  const wk = calls.filter(x => x.a.date >= monday);
  const tot = calls.length, rdv = calls.filter(x => x.a.res === 'Joint – intéressé (RDV)').length, adr = calls.filter(x => x.a.res === 'Adresse mail obtenue' || x.a.mail).length;
  const reste = ALL.filter(toCall).length + (CAMP_OK ? KL.filter(c => kCible(c) && !kDone(c) && kTel(c)).length : 0);
  const stats = [['Appels cette semaine', wk.length], ['Rendez-vous obtenus', rdv], ['Adresses obtenues', adr], ['Restent à appeler', reste]];
  if (NUM_OK) stats.push(['Numéros à chercher', ALL.filter(c => !c.tel && !c.intr).length]);
  $('weekStats').innerHTML = stats.map(([l, v]) => '<div class="stat"><div class="big num">' + v + '</div><div class="muted small">' + l + '</div></div>').join('');
  const by = {}; wk.forEach(x => { const p = nom(x.a.par); by[p] = (by[p] || 0) + 1; });
  $('byPerson').innerHTML = Object.entries(by).sort((x, y) => y[1] - x[1]).map(([p, n]) => '<li><span>' + esc(p) + '</span><b class="num">' + n + '</b></li>').join('') || '<li class="muted">Aucun appel noté cette semaine.</li>';
  const rap = calls.filter(x => x.a.rappel && x.a.rappel <= addDays(7)).sort((x, y) => x.a.rappel.localeCompare(y.a.rappel));
  $('rapCount').textContent = rap.length ? rap.length + ' dans les 7 jours' : '';
  $('rappels').innerHTML = rap.slice(0, 30).map(x => { const a = x.a, cl = a.rappel < today ? 'late' : a.rappel === today ? 'soon' : '';
    return '<li><div><b>' + esc(x.nom) + '</b><div class="muted small">' + esc(x.src === 'K' ? 'Campagne · ' + depTxt(x.dep) : depLabel(x.c)) + (a.pers ? ' · ' + esc(a.pers) : '') + (a.suite ? ' · ' + esc(a.suite) : '') + '</div></div><span class="chip ' + cl + '">' + (a.rappel < today ? 'En retard · ' : '') + fr(a.rappel) + '</span>' + openBtn(x) + '</li>'; }).join('') || '<li class="muted">Rien à rappeler pour l’instant.</li>';
  $('jourCount').textContent = day.length ? day.length + ' appel' + (day.length > 1 ? 's' : '') : '';
  $('jour').innerHTML = day.sort((x, y) => (y.a.maj || '').localeCompare(x.a.maj || '')).slice(0, 40).map(x => '<li><div><b>' + esc(x.nom) + '</b><div class="muted small">' + esc(x.src === 'K' ? 'Campagne · ' : '') + esc(depTxt(x.dep)) + ' · ' + esc(x.a.res) + ' · ' + esc(nom(x.a.par)) + (x.a.note ? ' – ' + esc(x.a.note.slice(0, 80)) : '') + '</div></div>' + openBtn(x).replace('Ouvrir la fiche', 'Corriger') + '</li>').join('') || '<li class="muted">Aucun appel noté aujourd’hui.</li>';
  const P = [[10, '10 appels'], [50, '50 appels'], [100, '100 appels'], [250, '250 appels'], [500, '500 appels'], [1000, '1 000 appels']];
  const b = P.map(([n, l]) => [tot >= n, l, tot >= n ? 'Atteint' : 'Encore ' + (n - tot)]);
  b.push([rdv >= 1, 'Premier rendez-vous', rdv >= 1 ? 'Atteint' : 'À décrocher']); b.push([adr >= 10, '10 adresses obtenues', adr >= 10 ? 'Atteint' : 'Encore ' + Math.max(0, 10 - adr)]);
  $('badges').innerHTML = b.map(([on, l, s]) => '<div class="badge' + (on ? ' on' : '') + '"><b>' + l + '</b><span class="small">' + s + '</span></div>').join('');
  renderSearch();
}

// ---------- recherche d'une structure (quelqu'un rappelle, on veut retrouver la fiche)
function renderSearch() {
  const q = norm($('gSearch').value).trim().split(/\s+/).filter(Boolean), z = $('gRes');
  if (!q.length || q.join('').length < 2) { z.innerHTML = ''; return; }
  const hay = c => c.h || (c.h = norm(c.nom + ' ' + c.dep + ' ' + (NAMES[c.dep] || '') + ' ' + (c.ville || '') + ' ' + (c.reg || '') + ' ' + (c.mail || '')));
  const hits = [];
  ALL.forEach(c => { if (q.every(t => hay(c).includes(t))) hits.push({ src: 'S', id: c.id, c, nom: c.nom, dep: c.dep }); });
  if (CAMP_OK) KL.forEach(c => { if (q.every(t => hay(c).includes(t))) hits.push({ src: 'K', id: c.id, c, nom: c.nom, dep: c.dep }); });
  z.innerHTML = hits.slice(0, 15).map(x => { const a = x.src === 'K' ? KA[x.id] : A[x.id];
    const st = a ? fr(a.date) + ' : ' + a.res : x.src === 'S' && !x.c.tel ? 'Pas de numéro' : 'Jamais appelé';
    return '<li><div><b>' + esc(x.nom) + '</b><div class="muted small">' + esc(x.src === 'K' ? 'Campagne · ' : '') + esc(depLabel(x.c)) + ' · ' + esc(st) + '</div></div>' + openBtn(x).replace('Ouvrir la fiche', 'Fiche') + '</li>'; }).join('') + (hits.length > 15 ? '<li class="muted small">Et ' + (hits.length - 15) + ' autres : précisez la recherche.</li>' : '') || '<li class="muted">Aucune structure trouvée.</li>';
}

// ---------- export des appels (CSV pour Excel, séparateur point-virgule)
const csvCell = v => { v = String(v == null ? '' : v).replace(/\r?\n/g, ' '); return /[;"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function exportCsv() {
  const per = $('exPer').value, since = per === 'jour' ? today : per === 'semaine' ? monday : '';
  const rows = allCalls().filter(x => !since || x.a.date >= since).sort((x, y) => (y.a.date || '').localeCompare(x.a.date || '') || (y.a.maj || '').localeCompare(x.a.maj || ''));
  const head = ['Source', 'Identifiant', 'Structure', 'Région', 'Département', 'Date', 'Appelé par', 'Résultat', 'Personne jointe', 'Note', 'À rappeler le', 'Adresse mail obtenue', 'Numéro trouvé'];
  const line = x => [x.src === 'K' ? 'Campagne 2Avenir' : x.c.k === 'R' ? 'Relance après mail' : 'Sans adresse mail', x.id, x.nom, x.c.reg, x.dep, x.a.date, nom(x.a.par), x.a.res, x.a.pers, x.a.note, x.a.rappel, x.a.mail, x.src === 'K' ? x.a.tel : (NUM[x.id] && NUM[x.id].tel) || ''].map(csvCell).join(';');
  const blob = new Blob(['﻿' + [head.join(';')].concat(rows.map(line)).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'appels_2A_Phoning_' + today + '.csv'; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(l.href), 4000); toast(rows.length + ' appel' + (rows.length > 1 ? 's' : '') + ' exporté' + (rows.length > 1 ? 's' : ''));
}

// ---------- séance
let Q = [], qi = 0, undo = null, single = null;
function depLabel(c) { return (NAMES[c.dep] || c.dep) + (c.ville ? ' · ' + c.ville : ''); }
function fillDeps() { const r = $('selReg').value; const deps = [...new Set(ALL.filter(c => c.reg === r).map(c => c.dep))].sort();
  $('selDep').innerHTML = '<option value="">Tous</option>' + deps.map(d => '<option value="' + d + '">' + d + ' – ' + esc(NAMES[d] || '') + '</option>').join('');
  if (ls.dep && deps.includes(ls.dep)) $('selDep').value = ls.dep; poolInfo(); }
function pool() { const r = $('selReg').value, d = $('selDep').value, l = $('selList').value;
  const p = ALL.filter(c => c.reg === r && (!d || c.dep === d) && (l === 'N' ? !c.tel && !c.intr : l.includes(c.k) && toCall(c)));
  p.sort((a, b) => (a.k === b.k ? 0 : a.k === 'R' ? -1 : 1) || (b.env || '').localeCompare(a.env || '') || a.nom.localeCompare(b.nom, 'fr')); return p; }
function poolInfo() { const p = pool(); if ($('selList').value === 'N') { $('poolInfo').textContent = !NUM_OK ? 'L’enregistrement des numéros n’est pas encore activé (Alexandre doit lancer 05_ameliorations.sql dans Supabase).' : p.length ? p.length + ' établissement' + (p.length > 1 ? 's' : '') + ' sans numéro dans cette sélection : cherchez-le sur le web, puis notez-le.' : 'Plus aucun numéro à chercher dans cette sélection.'; return; } $('poolInfo').textContent = p.length ? p.length + ' établissement' + (p.length > 1 ? 's' : '') + ' à appeler dans cette sélection (les relances après mail passent en premier, les mails les plus récents d’abord).' : 'Personne à appeler dans cette sélection : choisissez une autre région ou une autre liste.'; }
function openSingle(id) { single = id; location.hash = 'seance'; setTimeout(renderCard, 0); }
function script(c) { const nm = me.prenom ? me.prenom + (me.prenom === 'Antoine' ? ' Gadiou' : me.prenom === 'Alexandre' ? ' Bigot' : me.prenom === 'Sybille' ? ' Deterpigny' : '') : 'Antoine Gadiou';
  const fin = '<p class="muted small">Aucun prix, aucun nom d’employeur, aucune situation réelle.</p>';
  if (c.k === 'R') return '<p>« Bonjour, ' + esc(nm) + ', de 2A Formation, organisme de formation du travail social certifié Qualiopi. ' + (c.env ? 'Je vous ai envoyé le ' + fr(c.env) + ' un mail ' : 'Je vous ai envoyé un mail ') + (c.qui ? 'à l’attention de ' + esc(c.qui) + ' ' : '') + 'au sujet de nos formations en intra pour les équipes. Pourriez-vous me passer la personne qui s’occupe du plan de formation ? »</p><p>Avec la bonne personne : « Nous sommes éducateurs spécialisés et nous construisons chaque formation avec l’équipe, à partir de ses besoins. Puis-je vous renvoyer notre catalogue et convenir d’un court échange ? »</p>' + fin;
  return '<p>« Bonjour, ' + esc(nm) + ', de 2A Formation, organisme de formation du travail social certifié Qualiopi. Nous proposons des formations en intra pour les équipes éducatives et je souhaiterais en adresser la présentation à la direction' + (c.type ? ' de votre ' + esc(c.type.toLowerCase()) : '') + '. À quelle adresse mail puis-je l’envoyer ? »</p><p>Si on vous la donne : notez-la (bien épelée) dans le champ prévu. Alexandre préparera le mail.</p>' + fin; }
function renderCard() { const z = $('cardZone'); const id = single || Q[qi]; if (findMode && !single) return renderFind();
  if (!id) { z.innerHTML = Q.length ? '<div class="card"><h2>Séance terminée</h2><p>' + mineToday() + ' appel' + (mineToday() > 1 ? 's' : '') + ' noté' + (mineToday() > 1 ? 's' : '') + ' aujourd’hui. Merci !</p><div class="row"><a class="btn primary" href="#accueil">Revenir à l’accueil</a><button id="again">Nouvelle sélection</button></div></div>' : ''; const ag = $('again'); if (ag) ag.onclick = () => { Q = []; renderCard(); poolInfo(); }; return; }
  const c = C[id]; const a = A[id] || {}; const L = RES[c.k];
  z.innerHTML = '<div class="card">' +
    '<div class="row" style="justify-content:space-between"><span class="kind">' + (c.k === 'R' ? 'Relance après mail' : 'Sans adresse mail') + '</span><span class="muted small num">' + (single ? 'Fiche ouverte depuis l’accueil' : 'Appel ' + (qi + 1) + ' sur ' + Q.length) + '</span></div>' +
    '<div><h2>' + esc(c.nom) + '</h2><div class="muted">' + esc(depLabel(c)) + (c.k === 'S' && c.gest ? ' · ' + esc(c.gest) : '') + '</div></div>' +
    (c.qui ? '<div><span class="eyebrow">Mail adressé à</span><div>' + esc(c.qui) + '</div></div>' : '') +
    (c.ech ? '<div class="note small">L’adresse mail de cet établissement est en échec : demandez la bonne adresse pendant l’appel.</div>' : '') +
    (a.res ? '<div class="note small"><b>Appels précédents</b><br>' + fr(a.date) + ' : <b>' + esc(a.res) + '</b> (' + esc(nom(a.par)) + ')' + (a.pers ? ' · ' + esc(a.pers) : '') + (a.note ? ' – ' + esc(a.note) : '') + (a.hist || []).map(h => '<br>' + fr(h.date) + ' : ' + esc(h.res) + (h.note ? ' – ' + esc(h.note) : '')).join('') + '</div>' : '') +
    (c.tel ? '<div class="row"><span class="tel num" id="telTxt">' + esc(c.tel) + '</span></div>' +
    '<div class="row"><a class="btn call" href="tel:' + esc(c.tel.replace(/\s/g, '')) + '">Appeler</a><button id="cp">Copier le numéro</button></div>' : '<div class="note small">Pas de numéro pour cet établissement : cherchez-le (lien ci-dessous), notez-le, puis appelez.</div>') +
    numBlock(c) +
    '<details class="script" open><summary><b>Ce que je dis</b></summary>' + script(c) + '</details>' +
    '<div><div class="eyebrow" style="margin-bottom:8px">Résultat de l’appel</div><div class="res" id="resBtns">' + L.map(([r, t], i) => '<button class="' + t + '" data-r="' + esc(r) + '"><span class="kb">' + (i + 1) + '</span>' + esc(r) + '</button>').join('') + '</div></div>' +
    '<div class="row" id="more">' +
      '<label class="f">Personne jointe<input id="fPers" autocomplete="off" placeholder="Nom, fonction"></label>' +
      '<label class="f" id="wDate" hidden>Date de rappel ou de rendez-vous<input type="date" id="fDate"></label>' +
      (c.k === 'S' ? '<label class="f" id="wMail" hidden>Adresse mail obtenue<input id="fMail" type="email" autocomplete="off"></label>' : '') +
      '<label class="f" style="flex-basis:100%">Mes notes pendant l’appel<textarea id="fNote" rows="4" placeholder="Qui j’ai eu, ce qui a été dit, la suite à donner…"></textarea></label>' +
    '</div>' +
    '<div class="row" style="justify-content:space-between"><div class="row">' + (undo ? '<button id="undo">Annuler le dernier</button>' : '') + '</div><div class="row">' + (single ? '<a class="btn" href="#accueil">Fermer</a>' : '<button id="skip">Passer</button>') + '<button class="primary" id="ok" disabled>Enregistrer et suivant</button></div></div>' +
    '</div>';
  if (document.activeElement && !z.contains(document.activeElement) && /^(BUTTON|A)$/.test(document.activeElement.tagName)) document.activeElement.blur();
  let pick = null;
  try { const dn = (ls.drafts || {})[id]; if (dn) $('fNote').value = dn; } catch (e) {}
  $('fNote').addEventListener('input', () => { ls.drafts = ls.drafts || {}; ls.drafts[id] = $('fNote').value; save(); });
  if ($('cp')) $('cp').onclick = async () => { try { await navigator.clipboard.writeText(c.tel); toast('Numéro copié'); } catch (e) { const r = document.createRange(); r.selectNodeContents($('telTxt')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Numéro sélectionné : copiez-le'); } };
  $('resBtns').onclick = e => { const b = e.target.closest('button'); if (!b) return; pick = b.dataset.r;
    $('resBtns').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    const nd = NEEDDATE.includes(pick); $('wDate').hidden = !nd; if (nd && !$('fDate').value) $('fDate').value = addDays(pick === 'Joint – à rappeler' ? 7 : 3);
    if ($('wMail')) $('wMail').hidden = pick !== 'Adresse mail obtenue'; $('ok').disabled = false; };
  const ns = $('nSave'); if (ns) ns.onclick = async () => { if (await saveNum(c, $('nTel').value, false)) renderCard(); };
  const sk = $('skip'); if (sk) sk.onclick = () => { qi++; renderCard(); };
  const un = $('undo'); if (un) un.onclick = doUndo;
  $('ok').onclick = () => record(c, pick);
}
function numBlock(c) {
  if (!NUM_OK) return c.tel ? '' : '<p class="muted small">L’enregistrement des numéros n’est pas encore activé (Alexandre doit lancer 05_ameliorations.sql dans Supabase).</p>';
  return '<details class="script"' + (c.tel ? '' : ' open') + '><summary><b>' + (c.tel ? 'Corriger le numéro' : 'Ajouter le numéro') + '</b></summary><div class="row" style="margin-top:8px;align-items:flex-end"><label class="f">Numéro<input id="nTel" type="tel" autocomplete="off" value="' + esc(c.tel) + '"></label><button id="nSave">Enregistrer le numéro</button><a class="btn" target="_blank" rel="noopener" href="' + esc(searchUrl(c)) + '">Chercher sur le web</a></div></details>';
}
function renderFind() { const z = $('cardZone'); const id = Q[qi];
  if (!id) { z.innerHTML = Q.length ? '<div class="card"><h2>Liste terminée</h2><p>Plus aucun numéro à chercher dans cette sélection.</p><div class="row"><a class="btn primary" href="#accueil">Revenir à l’accueil</a><button id="again">Nouvelle sélection</button></div></div>' : ''; const ag = $('again'); if (ag) ag.onclick = () => { Q = []; findMode = false; renderCard(); poolInfo(); }; return; }
  const c = C[id];
  z.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><span class="kind">Numéro à chercher</span><span class="muted small num">' + (qi + 1) + ' sur ' + Q.length + '</span></div>' +
    '<div><h2>' + esc(c.nom) + '</h2><div class="muted">' + esc(depLabel(c)) + '</div></div>' +
    (c.qui ? '<div><span class="eyebrow">Mail adressé à</span><div>' + esc(c.qui) + '</div></div>' : '') +
    (c.mail ? '<div><span class="eyebrow">Adresse mail connue</span><div>' + esc(c.mail) + '</div></div>' : '') +
    '<div class="row"><a class="btn call" target="_blank" rel="noopener" href="' + esc(searchUrl(c)) + '">Chercher sur le web</a></div>' +
    '<label class="f">Numéro trouvé<input id="nTel" type="tel" autocomplete="off" placeholder="05 61 00 00 00"></label>' +
    '<div class="row" style="justify-content:space-between"><button id="nNone">Introuvable</button><div class="row"><button id="nSkip">Passer</button><button class="primary" id="nSave">Enregistrer et suivant</button></div></div></div>';
  $('nSave').onclick = async () => { if (await saveNum(c, $('nTel').value, false)) { qi++; renderFind(); } };
  $('nNone').onclick = async () => { if (await saveNum(c, '', true)) { qi++; renderFind(); } };
  $('nSkip').onclick = () => { qi++; renderFind(); };
}
async function record(c, res) { if (!res) return; const prev = A[c.id] ? JSON.parse(JSON.stringify(A[c.id])) : null;
  const hist = (prev && prev.res ? [{ res: prev.res, date: prev.date || '', par: prev.par || '', note: prev.note || '', pers: prev.pers || '' }].concat(prev.hist || []) : []).slice(0, 10);
  const body = { res, date: today, par: me.email, maj: new Date().toISOString(), pers: $('fPers').value.trim(), note: $('fNote').value.trim(), suite: '', rappel: NEEDDATE.includes(res) ? ($('fDate').value || '') : '', mail: $('fMail') ? $('fMail').value.trim() : '', hist };
  $('ok').disabled = true;
  const r = await send({ table: 'appels', op: 'upsert', row: toRow(c.id, body) });
  if (r.error) { toast('Enregistrement impossible pour le moment : réessayez dans un instant.'); $('ok').disabled = false; return; }
  A[c.id] = body; sess.n++; undo = { id: c.id, prev }; toast(r.queued ? 'Hors connexion : appel gardé, envoi dès le retour du réseau' : 'Appel enregistré');
  if (ls.drafts && ls.drafts[c.id]) { delete ls.drafts[c.id]; save(); }
  if (single) { single = null; location.hash = 'accueil'; return; }
  qi++; renderCard(); }
async function doUndo() { if (!undo) return; const u = undo; undo = null;
  const r = await send(u.prev ? { table: 'appels', op: 'upsert', row: toRow(u.id, u.prev) } : { table: 'appels', op: 'delete', key: 'etab_id', val: u.id });
  if (r.error) { toast('Annulation impossible pour le moment.'); return; }
  if (u.prev) A[u.id] = u.prev; else delete A[u.id]; sess.n = Math.max(0, sess.n - 1);
  if (!single) { const k = Q.indexOf(u.id); if (k >= 0) qi = k; } toast('Dernier appel annulé'); renderCard(); }

// ---------- carte
const NAMES = {}; let mapDrawn = false, selDep = null, GEO = '';
const K = Math.cos(46.6 * Math.PI / 180), M = { x0: -5.3, x1: 9.7, y0: 41.25, y1: 51.2 }, S = Math.min(760 / ((M.x1 - M.x0) * K), 960 / (M.y1 - M.y0));
const pm = (lon, lat) => [20 + (lon - M.x0) * K * S, 20 + (M.y1 - lat) * S];
const DOM = { '971': { n: 'Guadeloupe', b: [-61.85, 15.8, -61.0, 16.55] }, '972': { n: 'Martinique', b: [-61.25, 14.38, -60.8, 14.9] }, '973': { n: 'Guyane', b: [-54.7, 2.1, -51.6, 5.8] }, '974': { n: 'La Réunion', b: [55.2, -21.4, 55.85, -20.85] }, '976': { n: 'Mayotte', b: [45.0, -13.02, 45.32, -12.62] } };
const IN = [['971', 800, 40], ['972', 800, 215], ['973', 800, 390], ['974', 800, 565], ['976', 800, 740]], BOX = 170;
IN.forEach(([c, x, y]) => { const o = DOM[c], b = o.b, kk = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), w = (b[2] - b[0]) * kk, h = b[3] - b[1], s = (BOX - 30) / Math.max(w, h); o.f = (lon, lat) => [x + 15 + (BOX - 30 - w * s) / 2 + (lon - b[0]) * kk * s, y + 22 + (BOX - 30 - h * s) / 2 + (b[3] - lat) * s]; });
const IDF = ['75', '77', '78', '91', '92', '93', '94', '95'], IB = { x: 20, y: 600, w: 215, h: 215, b: [1.42, 48.1, 3.57, 49.25] };
(function () { const b = IB.b, kk = Math.cos(48.7 * Math.PI / 180), w = (b[2] - b[0]) * kk, h = b[3] - b[1], s = (IB.w - 20) / Math.max(w, h); IB.f = (lon, lat) => [IB.x + 10 + (IB.w - 20 - w * s) / 2 + (lon - b[0]) * kk * s, IB.y + 24 + (IB.h - 30 - h * s) / 2 + (b[3] - lat) * s]; })();
const proj = (d, lon, lat) => DOM[d] ? DOM[d].f(lon, lat) : pm(lon, lat);
const NS = 'http://www.w3.org/2000/svg', el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const GP = {}, GP2 = {};
function parseGeo(g) { g.split('\n').forEach(line => { if (!line) return; const [c, n, m, r] = line.split('|'); NAMES[c] = n; const mult = +m; let d = '', d2 = ''; const zi = IDF.includes(c);
  r.split(';').forEach(ring => { let X = 0, Y = 0; ring.split(' ').forEach((pr, i) => { const [a, b] = pr.split(',').map(Number); X += a; Y += b; const [px, py] = proj(c, X / mult, Y / mult); d += (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1); if (zi) { const [qx, qy] = IB.f(X / mult, Y / mult); d2 += (i ? 'L' : 'M') + qx.toFixed(1) + ',' + qy.toFixed(1); } }); d += 'Z'; if (zi) d2 += 'Z'; });
  GP[c] = d; if (zi) GP2[c] = d2; }); }
const geoReady = fetch('departements.txt').then(r => r.text()).then(t => { GEO = t; parseGeo(t); }).catch(() => {});
const STEPS = ['var(--land-0)', 'color-mix(in srgb, var(--accent) 25%, var(--land))', 'color-mix(in srgb, var(--accent) 50%, var(--land))', 'color-mix(in srgb, var(--accent) 75%, var(--land))', 'var(--accent)'];
['l1', 'l2', 'l3', 'l4'].forEach((id, i) => $(id).style.background = STEPS[i + 1]);
function depStats() { const s = {}; ALL.forEach(c => { const o = s[c.dep] || (s[c.dep] = { n: 0, a: 0, t: 0 }); o.n++; if (A[c.id]) o.a++; if (toCall(c)) o.t++; }); return s; }
async function drawMap() { await geoReady; const st = depStats(); const gd = $('deps');
  if (!mapDrawn && GEO) { mapDrawn = true; const gi = $('insets');
    IN.forEach(([c, x, y]) => { gi.appendChild(el('rect', { x, y, width: BOX, height: BOX, rx: 6, class: 'inset-frame' })); const t = el('text', { x: x + 10, y: y + 16, class: 'inset-lbl' }); t.textContent = DOM[c].n; gi.appendChild(t); });
    gi.appendChild(el('rect', { x: IB.x, y: IB.y, width: IB.w, height: IB.h, rx: 6, class: 'inset-frame' })); const t = el('text', { x: IB.x + 10, y: IB.y + 16, class: 'inset-lbl' }); t.textContent = 'Île-de-France'; gi.appendChild(t);
    Object.keys(GP).forEach(c => gd.appendChild(el('path', { d: GP[c], class: 'dep' + ((c === '11' || c === '31') ? ' excl' : ''), 'data-c': c, tabindex: 0, role: 'button', 'aria-label': NAMES[c] })));
    Object.keys(GP2).forEach(c => gd.appendChild(el('path', { d: GP2[c], class: 'dep', 'data-c': c, 'aria-hidden': 'true' })));
    gd.addEventListener('click', e => { const p = e.target.closest('.dep'); if (p && !p.classList.contains('excl')) depPanel(p.dataset.c); });
    gd.addEventListener('keydown', e => { if (e.key === 'Enter') { const p = e.target.closest('.dep'); if (p) depPanel(p.dataset.c); } }); }
  gd.querySelectorAll('.dep').forEach(p => { const o = st[p.dataset.c]; const r = o && o.n ? o.a / o.n : 0; p.style.fill = !o ? 'var(--land)' : STEPS[r === 0 ? 0 : r < .25 ? 1 : r < .5 ? 2 : r < .75 ? 3 : 4]; p.classList.toggle('sel', p.dataset.c === selDep); });
  depPanel(selDep); }
function depPanel(c) { selDep = c; const st = depStats(); const P = $('depPanel');
  $('deps').querySelectorAll('.dep').forEach(p => p.classList.toggle('sel', p.dataset.c === c));
  if (!c) { const tot = ALL.length, a = ALL.filter(x => A[x.id]).length;
    const top = Object.entries(st).filter(([d, o]) => o.t).sort((x, y) => y[1].t - x[1].t).slice(0, 8);
    P.innerHTML = '<h2>France entière</h2><p class="big num" style="margin:12px 0 4px">' + a + ' <span class="muted" style="font-size:18px">/ ' + tot + '</span></p><p class="muted small">établissements déjà appelés</p><div class="gauge"><i style="width:' + (tot ? a / tot * 100 : 0) + '%"></i></div><h3 style="margin-top:18px">Là où il reste le plus d’appels</h3><ul class="list small">' + top.map(([d, o]) => '<li><span>' + d + ' – ' + esc(NAMES[d] || '') + '</span><b class="num">' + o.t + '</b></li>').join('') + '</ul>'; return; }
  const o = st[c] || { n: 0, a: 0, t: 0 }; const list = ALL.filter(x => x.dep === c);
  P.innerHTML = '<div class="eyebrow">' + c + '</div><h2>' + esc(NAMES[c] || c) + '</h2><p class="muted small" style="margin:8px 0">' + o.a + ' appelé' + (o.a > 1 ? 's' : '') + ' sur ' + o.n + ' · ' + o.t + ' à appeler</p><div class="gauge"><i style="width:' + (o.n ? o.a / o.n * 100 : 0) + '%"></i></div>' +
    '<div class="row" style="margin:14px 0"><button class="primary" id="depGo"' + (o.t ? '' : ' disabled') + '>Lancer une séance ici</button><button id="depAll">Toute la France</button></div>' +
    '<ul class="list small">' + list.sort((x, y) => (A[x.id] ? 1 : 0) - (A[y.id] ? 1 : 0) || x.nom.localeCompare(y.nom, 'fr')).slice(0, 80).map(x => '<li><div><b>' + esc(x.nom) + '</b><div class="muted">' + (x.k === 'R' ? 'Relance après mail' : 'Sans mail') + (A[x.id] ? ' · ' + esc(A[x.id].res) : '') + '</div></div>' + (x.tel ? '<button data-open="' + x.id + '">Fiche</button>' : '<span class="chip">Pas de numéro</span>') + '</li>').join('') + '</ul>' + (list.length > 80 ? '<p class="muted small">Et ' + (list.length - 80) + ' autres : lancez une séance pour les voir un par un.</p>' : '');
  $('depAll').onclick = () => depPanel(null);
  $('depGo').onclick = () => { const any = ALL.find(x => x.dep === c); $('selReg').value = any.reg; ls.reg = any.reg; fillDeps(); $('selDep').value = c; ls.dep = c; $('selList').value = 'RS'; findMode = false; save(); poolInfo(); location.hash = 'seance'; single = null; Q = pool().map(x => x.id); qi = 0; setTimeout(renderCard, 0); }; }

// ---------- campagne (mail 2Avenir) : d'abord les adresses en échec, puis les structures sans réponse au mail
let CAMP_OK = false, KL = [], KC = {}, KA = {}, kOpen = null, kQueue = [], kUndo = null;
const KRES = [['Adresse mail obtenue', 'g'], ['Mail bien reçu', 'g'], ['Joint – intéressé (RDV)', 'g'], ['Joint – à rappeler', 'w'], ['Message laissé', 'n'], ['Transmis au standard', 'n'], ['Pas intéressé', 'b'], ['Ne plus contacter', 'b'], ['Mauvais numéro', 'b'], ['Injoignable', 'n']];
const KWAIT = 7; // jours après l'envoi du mail avant d'appeler une structure qui n'a pas répondu
function kFromRow(r) { return { maj: r.maj || '', res: r.resultat, date: r.date_appel, pers: r.personne || '', note: r.note || '', rappel: r.rappel || '', mail: r.mail_obtenu || '', tel: r.tel_trouve || '', par: r.par || '', hist: r.hist || [] }; }
function kToRow(id, a) { return { cible_id: id, resultat: a.res, date_appel: a.date, personne: a.pers, note: a.note, rappel: a.rappel || null, mail_obtenu: a.mail || '', tel_trouve: a.tel || '', par: a.par, hist: a.hist || [], maj: new Date().toISOString() }; }
async function loadCampagne() {
  try { const [c, a] = await Promise.all([fetchAll('campagne_cibles', 'id'), fetchAll('campagne_appels', 'cible_id')]);
    KL = c.map(r => ({ id: r.id, etab: r.etab_id || '', reg: r.region || 'Non précisé', dep: r.dep || '', sect: r.secteur || '', nom: r.nom, mail: r.email || '', tel: r.tel || '', st: r.statut, env: r.date_envoi || '' }));
    KL.forEach(c => KC[c.id] = c); KA = {}; a.forEach(r => KA[r.cible_id] = kFromRow(r)); CAMP_OK = true;
  } catch (e) { CAMP_OK = false; } // tables pas encore créées : le reste de l'appli fonctionne normalement
}
const kTel = c => (KA[c.id] && KA[c.id].tel) || c.tel;
const kSansRep = c => c.st === 'envoye' && c.env && c.env <= addDays(-KWAIT);
const kCible = c => c.st === 'echec' || kSansRep(c);
function kDone(c) { const a = KA[c.id]; if (!a) return false; if (a.rappel) return a.rappel > today; if (RETRY.includes(a.res)) return a.date > addDays(-7); return true; }
function kKind(c) { return c.st === 'echec' ? 'Adresse en échec' : c.st === 'envoye' ? (kSansRep(c) ? 'Sans réponse au mail' : 'Mail envoyé le ' + fr(c.env)) : c.st === 'repondu' ? 'A répondu' : 'Mail pas encore envoyé'; }
function kPool() { const l = $('kList').value, r = $('kReg').value, s = $('kSearch').value.trim().toLowerCase();
  const p = KL.filter(c => (!r || c.reg === r) && (!s || (c.nom + ' ' + c.dep + ' ' + c.mail).toLowerCase().includes(s)) && (
    l === 'todo' ? kCible(c) && !kDone(c) : l === 'echec' ? c.st === 'echec' : l === 'sansrep' ? kSansRep(c) : l === 'rappel' ? KA[c.id] && KA[c.id].rappel : l === 'faits' ? !!KA[c.id] : true));
  p.sort((a, b) => (a.st === 'echec' ? 0 : 1) - (b.st === 'echec' ? 0 : 1) || (kTel(a) ? 0 : 1) - (kTel(b) ? 0 : 1) || a.reg.localeCompare(b.reg, 'fr') || a.dep.localeCompare(b.dep) || a.nom.localeCompare(b.nom, 'fr'));
  return p; }
function renderCampagne() {
  if (!CAMP_OK) { $('kMissing').hidden = false; $('kMain').hidden = true; return; }
  $('kMissing').hidden = true; $('kMain').hidden = !!kOpen; $('kCard').hidden = !kOpen; if (kOpen) return;
  if (INFOS.campagne_titre) $('kTitle').textContent = INFOS.campagne_titre;
  const ech = KL.filter(c => c.st === 'echec'), sr = KL.filter(kSansRep), vals = Object.values(KA);
  $('kStats').innerHTML = [['Adresses en échec à appeler', ech.filter(c => !kDone(c)).length], ['Sans réponse à appeler', sr.filter(c => !kDone(c)).length], ['Appels notés', vals.length], ['Adresses recueillies', vals.filter(a => a.mail).length]].map(([l, v]) => '<div class="stat"><div class="big num">' + v + '</div><div class="muted small">' + l + '</div></div>').join('');
  const env = KL.filter(c => c.st === 'envoye' && !kSansRep(c)).length;
  $('kInfo').textContent = env ? env + ' structure' + (env > 1 ? 's' : '') + ' ont reçu le mail il y a moins de ' + KWAIT + ' jours : elles apparaîtront ici si elles ne répondent pas.' : '';
  const p = kPool(), max = 150;
  $('kCount').textContent = p.length + ' structure' + (p.length > 1 ? 's' : '');
  $('kRows').innerHTML = p.slice(0, max).map(c => { const a = KA[c.id]; const t = kTel(c);
    return '<li><div><b>' + esc(c.nom) + '</b><div class="muted">' + esc((NAMES[c.dep] ? c.dep + ' – ' + NAMES[c.dep] : c.dep) + (c.sect ? ' · ' + c.sect : '')) + '</div><div class="small"><span class="chip' + (c.st === 'echec' ? ' late' : '') + '">' + esc(kKind(c)) + '</span>' + (a ? ' <span class="muted">' + fr(a.date) + ' : ' + esc(a.res) + (a.rappel ? ' · rappel le ' + fr(a.rappel) : '') + '</span>' : '') + '</div></div>' +
      (t ? '' : '<span class="chip">Pas de numéro</span>') + '<button data-kopen="' + c.id + '">Fiche</button></li>'; }).join('') || '<li class="muted">Aucune structure dans cette sélection.</li>';
  $('kMore').textContent = p.length > max ? 'Et ' + (p.length - max) + ' autres : affinez avec la région ou la recherche.' : '';
  $('kUndo').hidden = !kUndo; }
function kScript(c) { const nm = me.prenom ? me.prenom + (me.prenom === 'Antoine' ? ' Gadiou' : me.prenom === 'Alexandre' ? ' Bigot' : me.prenom === 'Sybille' ? ' Deterpigny' : '') : 'Antoine Gadiou';
  const deb = '« Bonjour, ' + esc(nm) + ', de 2A Formation, organisme de formation du travail social certifié Qualiopi. ';
  const fin = '<p class="muted small">Aucun prix, aucun chiffre de temps gagné, aucune situation réelle. Si on vous donne une adresse, notez-la bien épelée.</p>';
  if (c.st === 'echec') return '<p>' + deb + 'Nous avons voulu adresser à la direction un mail de présentation de 2Avenir, le logiciel de 2A Formation, mais il n’a pas pu être remis à l’adresse que nous avions. À quelle adresse puis-je l’envoyer ? »</p>' + fin;
  return '<p>' + deb + (c.env ? 'Je vous ai envoyé le ' + fr(c.env) + ' ' : 'Je vous ai envoyé ') + 'un mail pour vous présenter 2Avenir, le logiciel de 2A Formation. Je voulais m’assurer qu’il vous était bien parvenu. Pourriez-vous me passer la personne de la direction qui pourrait être concernée ? »</p>' + fin; }
function kOpenCard(id, queue) { kOpen = id; if (queue) kQueue = queue; location.hash = 'campagne'; renderCampagne(); kCardRender(); window.scrollTo(0, 0); }
function kCardRender() { const c = KC[kOpen]; if (!c) { kOpen = null; renderCampagne(); return; }
  const a = KA[c.id] || {}, t = kTel(c), main = c.etab && A[c.etab]; const pos = kQueue.indexOf(c.id);
  $('kCard').innerHTML = '<div class="card">' +
    '<div class="row" style="justify-content:space-between"><span class="kind">' + esc(kKind(c)) + '</span><span class="muted small num">' + (pos >= 0 ? 'Structure ' + (pos + 1) + ' sur ' + kQueue.length : '') + '</span></div>' +
    '<div><h2>' + esc(c.nom) + '</h2><div class="muted">' + esc((NAMES[c.dep] || c.dep) + (c.sect ? ' · ' + c.sect : '')) + '</div></div>' +
    (c.mail ? '<div><span class="eyebrow">' + (c.st === 'echec' ? 'Adresse en échec' : 'Adresse du mail') + '</span><div>' + esc(c.mail) + '</div></div>' : '') +
    (a.res ? '<div class="note small"><b>Appels de la campagne</b><br>' + fr(a.date) + ' : <b>' + esc(a.res) + '</b> (' + esc(nom(a.par)) + ')' + (a.pers ? ' · ' + esc(a.pers) : '') + (a.mail ? ' · adresse : ' + esc(a.mail) : '') + (a.note ? ' – ' + esc(a.note) : '') + (a.hist || []).map(h => '<br>' + fr(h.date) + ' : ' + esc(h.res) + (h.note ? ' – ' + esc(h.note) : '')).join('') + '</div>' : '') +
    (main ? '<div class="note small"><b>Déjà appelée pour la prospection</b><br>' + fr(main.date) + ' : ' + esc(main.res) + (main.note ? ' – ' + esc(main.note) : '') + '</div>' : '') +
    (t ? '<div class="row"><span class="tel num" id="kTelTxt">' + esc(t) + '</span></div><div class="row"><a class="btn call" href="tel:' + esc(t.replace(/\s/g, '')) + '">Appeler</a><button id="kCp">Copier le numéro</button></div>'
       : '<div class="note small">Pas de numéro connu : cherchez-le sur le site de la structure, puis notez-le ci-dessous.</div>') +
    '<details class="script" open><summary><b>Ce que je dis</b></summary>' + kScript(c) + '</details>' +
    '<div><div class="eyebrow" style="margin-bottom:8px">Résultat de l’appel</div><div class="res" id="kRes">' + KRES.map(([r, s], i) => '<button class="' + s + '" data-r="' + esc(r) + '"><span class="kb">' + (i + 1) + '</span>' + esc(r) + '</button>').join('') + '</div></div>' +
    '<div class="row">' +
      '<label class="f">Personne jointe<input id="kPers" autocomplete="off" placeholder="Nom, fonction"></label>' +
      '<label class="f">Nouvelle adresse mail recueillie<input id="kMail" type="email" autocomplete="off" placeholder="prenom.nom@structure.fr"></label>' +
      (t ? '' : '<label class="f">Numéro trouvé<input id="kTelIn" type="tel" autocomplete="off"></label>') +
      '<label class="f">À rappeler le<input type="date" id="kDate"></label>' +
      '<label class="f" style="flex-basis:100%">Mes notes pendant l’appel<textarea id="kNote" rows="4" placeholder="Qui j’ai eu, ce qui a été dit, la suite à donner…"></textarea></label>' +
    '</div>' +
    '<div class="row" style="justify-content:flex-end"><button id="kClose">Revenir à la liste</button>' + (pos >= 0 && pos < kQueue.length - 1 ? '<button id="kSkip">Passer</button>' : '') + '<button class="primary" id="kOk" disabled>Enregistrer</button></div></div>';
  let pick = null;
  try { const dn = (ls.kdrafts || {})[c.id]; if (dn) $('kNote').value = dn; } catch (e) {}
  $('kNote').addEventListener('input', () => { ls.kdrafts = ls.kdrafts || {}; ls.kdrafts[c.id] = $('kNote').value; save(); });
  const cp = $('kCp'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(t); toast('Numéro copié'); } catch (e) { toast('Copie impossible : sélectionnez le numéro'); } };
  $('kRes').onclick = e => { const b = e.target.closest('button'); if (!b) return; pick = b.dataset.r;
    $('kRes').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    if (NEEDDATE.includes(pick) && !$('kDate').value) $('kDate').value = addDays(pick === 'Joint – à rappeler' ? 7 : 3);
    $('kOk').disabled = false; };
  $('kClose').onclick = () => { kOpen = null; renderCampagne(); };
  const sk = $('kSkip'); if (sk) sk.onclick = () => kOpenCard(kQueue[pos + 1]);
  $('kOk').onclick = () => kRecord(c, pick); }
async function kRecord(c, res) { if (!res) return; const prev = KA[c.id] ? JSON.parse(JSON.stringify(KA[c.id])) : null;
  const mail = $('kMail').value.trim(); if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { toast('L’adresse mail semble incomplète : vérifiez-la.'); return; }
  const hist = (prev && prev.res ? [{ res: prev.res, date: prev.date || '', par: prev.par || '', note: prev.note || '', pers: prev.pers || '' }].concat(prev.hist || []) : []).slice(0, 10);
  const body = { res, date: today, par: me.email, maj: new Date().toISOString(), pers: $('kPers').value.trim(), note: $('kNote').value.trim(), rappel: $('kDate').value || '', mail: mail || (prev && prev.mail) || '', tel: ($('kTelIn') ? $('kTelIn').value.trim() : '') || (prev && prev.tel) || '', hist };
  $('kOk').disabled = true;
  const r = await send({ table: 'campagne_appels', op: 'upsert', row: kToRow(c.id, body) });
  if (r.error) { toast('Enregistrement impossible pour le moment : réessayez dans un instant.'); $('kOk').disabled = false; return; }
  KA[c.id] = body; kUndo = { id: c.id, prev }; toast(r.queued ? 'Hors connexion : appel gardé, envoi dès le retour du réseau' : 'Appel enregistré'); sess.n++;
  if (ls.kdrafts && ls.kdrafts[c.id]) { delete ls.kdrafts[c.id]; save(); }
  const pos = kQueue.indexOf(c.id);
  if (pos >= 0 && pos < kQueue.length - 1) kOpenCard(kQueue[pos + 1]); else { kOpen = null; renderCampagne(); } }
async function kDoUndo() { if (!kUndo) return; const u = kUndo; kUndo = null;
  const r = await send(u.prev ? { table: 'campagne_appels', op: 'upsert', row: kToRow(u.id, u.prev) } : { table: 'campagne_appels', op: 'delete', key: 'cible_id', val: u.id });
  if (r.error) { toast('Annulation impossible pour le moment.'); return; }
  if (u.prev) KA[u.id] = u.prev; else delete KA[u.id]; sess.n = Math.max(0, sess.n - 1); toast('Dernier appel annulé'); renderCampagne(); }

// ---------- travail à deux : demandes (tâches), clients modifiables, formations, notes (script SQL 06)
let TA = [], FO = [], FI = [], NO = [], TRAVAIL_OK = false, CLI_EDIT = false, taLoaded = false;
let tOpen = null, cOpen = null, fOpen = null, nArm = null, prefill = null, tNew = new Set(), tType = 'Devis';
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const dateOnly = s => /^\d{4}-\d{2}-\d{2}/.test(s || '') ? String(s).slice(0, 10) : '';
const isMe = p => !!me.prenom && norm(p).includes(norm(me.prenom));
const fdt = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
const MISS = '<h2>Pas encore activé</h2><p class="muted">Alexandre doit lancer une fois le script 06_travail.sql dans Supabase (SQL Editor). Rien d’autre ne change d’ici là.</p>';
const TYPES = ['Devis', 'Formation', 'Autre'];

function notifyNew(old, neu) {
  if (taLoaded) {
    const prev = {}; old.forEach(t => prev[t.id] = t);
    neu.forEach(t => { const p = prev[t.id]; let msg = '';
      if (t.pour === me.prenom && t.de && t.de !== me.prenom && !t.vu && !p) msg = 'Nouvelle demande de ' + t.de + ' : ' + t.titre;
      else if (t.de === me.prenom && t.fait && t.fait_par !== me.prenom && p && !p.fait) msg = t.fait_par + ' a terminé : ' + t.titre;
      if (msg) { toast(msg); try { if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('2A Travail', { body: msg }); } catch (e) {} } });
  }
  taLoaded = true;
}
async function loadTravail() {
  try {
    const [t, f, fi, n] = await Promise.all([fetchAll('taches', 'cree_le'), fetchAll('formations', 'cree_le'), fetchAll('formation_items', 'ordre'), fetchAll('notes', 'cree_le')]);
    notifyNew(TA, t); TA = t; FO = f; FI = fi; NO = n; TRAVAIL_OK = true;
  } catch (e) { TRAVAIL_OK = false; }
  try { const r = await sb.from('clients').select('maj').limit(1); CLI_EDIT = !r.error; } catch (e) { CLI_EDIT = false; }
}
let rlT;
function watchTravail() { ['taches', 'formations', 'formation_items', 'notes', 'clients'].forEach(t => sb.channel('w_' + t).on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { clearTimeout(rlT); rlT = setTimeout(reloadTravail, 500); }).subscribe()); }
async function reloadTravail() { try { await loadTravail(); CLI = await fetchAll('clients', 'ordre'); } catch (e) {} refreshCurrent(); }

const incoming = () => TA.filter(t => !t.fait && t.pour === me.prenom);
const unseen = () => TA.filter(t => (t.pour === me.prenom && t.de && t.de !== me.prenom && !t.vu) || (t.de === me.prenom && t.fait && t.fait_par !== me.prenom && t.retour_vu === false));
function updateBadge() { const b = $('tBadge'); if (!b) return; const n = TRAVAIL_OK ? unseen().length : 0; b.hidden = !n; b.textContent = n; }
function dueChip(d) { if (!d) return ''; const cl = d < today ? 'late' : d === today ? 'soon' : ''; return '<span class="chip ' + cl + '">' + (d < today ? 'En retard · ' : '') + fr(d) + '</span>'; }
function seg(id, items, cur) { $(id).innerHTML = items.map(([v, l, n]) => '<button data-f="' + v + '" aria-pressed="' + (v === cur) + '">' + esc(l) + (n != null ? ' <span class="num">' + n + '</span>' : '') + '</button>').join(''); }
const pourOptions = sel => Object.values(MEMBRES).map(p => '<option value="' + esc(p) + '"' + (p === sel ? ' selected' : '') + '>' + esc(p === me.prenom ? p + ' (moi)' : p) + '</option>').join('');
async function persist(job, onFail) { const r = await send(job); if (r.error) { toast('Enregistrement impossible pour le moment : réessayez.'); if (onFail) onFail(); return false; } if (r.queued) toast('Hors connexion : gardé, envoi dès le retour du réseau'); return true; }

// ----- demandes (tâches)
function fillTForm() {
  const s = $('tPour'); if (!s.options.length || s.dataset.me !== me.prenom) { const def = Object.values(MEMBRES).find(p => p !== me.prenom) || me.prenom; s.innerHTML = pourOptions(def); s.dataset.me = me.prenom; }
  const cl = [...new Set(CLI.map(r => r.structure).concat(FO.map(f => f.client)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('tClients').innerHTML = cl.map(c => '<option value="' + esc(c) + '">').join('');
  document.querySelectorAll('#tType button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === tType));
  $('tClientLbl').firstChild.textContent = tType === 'Autre' ? 'Structure (si elle est concernée)' : 'Structure concernée';
  $('tDetailLbl').firstChild.textContent = tType === 'Autre' ? 'Ce qu’il y a à faire' : 'Précisions (facultatif)';
}
function taskRow(t) {
  const sent = t.de && t.de !== t.pour;
  return '<li><button class="chk' + (t.fait ? ' on' : '') + '" data-tdone="' + esc(t.id) + '" aria-label="' + (t.fait ? 'Remettre à faire' : 'Marquer comme fait') + '">' + (t.fait ? '✓' : '') + '</button><div><b' + (t.fait ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' + esc(t.titre) + '</b>' +
    '<div class="muted small">' + (sent ? 'De ' + esc(t.de) + ' pour ' + esc(t.pour) : 'Pour ' + esc(t.pour)) + (t.detail ? ' · ' + esc(t.detail.slice(0, 120)) : '') + (t.fait && t.fait_par ? ' · fait par ' + esc(t.fait_par) + (t.fait_le ? ' le ' + fr(t.fait_le.slice(0, 10)) : '') : '') + '</div></div>' +
    (tNew.has(t.id) ? '<span class="chip ok">Nouveau</span>' : '') + (t.fait ? '' : dueChip(dateOnly(t.echeance))) + '<button data-topen="' + esc(t.id) + '">Modifier</button></li>';
}
function renderTaches() {
  $('tMissing').hidden = TRAVAIL_OK; $('tMain').hidden = !TRAVAIL_OK || !!tOpen; $('tCard').hidden = !tOpen;
  if (!TRAVAIL_OK) return; if (tOpen) return;
  unseen().forEach(t => { tNew.add(t.id); if (t.pour === me.prenom) t.vu = true; else t.retour_vu = true; persist({ table: 'taches', op: 'upsert', row: { ...t } }); });
  updateBadge(); fillTForm();
  if (prefill) { tType = prefill.type || tType; fillTForm(); $('tClient').value = prefill.client || ''; prefill = null; setTimeout(() => $('tDetail').focus(), 50); }
  const f = ls.tf || 'mes', mine = incoming(), env = TA.filter(t => !t.fait && t.de === me.prenom && t.pour !== me.prenom), done = TA.filter(t => t.fait && (t.de === me.prenom || t.pour === me.prenom));
  seg('tSeg', [['mes', 'À faire pour moi', mine.length], ['env', 'Envoyées', env.length], ['faites', 'Faites', done.length]], f);
  let list = f === 'mes' ? mine : f === 'env' ? env : done;
  list = list.slice().sort(f === 'faites' ? (a, b) => (b.fait_le || '').localeCompare(a.fait_le || '') : (a, b) => (dateOnly(a.echeance) || '9999').localeCompare(dateOnly(b.echeance) || '9999') || (a.cree_le || '').localeCompare(b.cree_le || ''));
  $('tList').innerHTML = list.slice(0, 100).map(taskRow).join('') || '<li class="muted">' + (f === 'faites' ? 'Rien de terminé pour l’instant.' : f === 'env' ? 'Aucune demande en attente.' : 'Rien à faire : bravo.') + '</li>';
  const nb = $('tNotif'); nb.hidden = !(window.Notification && Notification.permission === 'default');
}
async function addTask() {
  const client = $('tClient').value.trim(), detail = $('tDetail').value.trim();
  if (tType === 'Autre' ? !detail : !client) { toast(tType === 'Autre' ? 'Dites en quelques mots ce qu’il y a à faire.' : 'Indiquez la structure concernée.'); return; }
  const pour = $('tPour').value || me.prenom;
  const row = { id: uid(), titre: tType === 'Autre' ? detail.slice(0, 80) : tType + ' – ' + client, type: tType, client, detail: tType === 'Autre' ? '' : detail, de: me.prenom, pour, echeance: $('tDate').value || null, fait: false, fait_le: null, fait_par: '', vu: pour === me.prenom, retour_vu: true, cree_le: nowIso(), maj: nowIso() };
  TA.push(row); $('tClient').value = ''; $('tDetail').value = ''; $('tDate').value = ''; renderTaches();
  if (await persist({ table: 'taches', op: 'upsert', row: { ...row } }, () => { TA = TA.filter(x => x.id !== row.id); renderTaches(); })) toast(pour === me.prenom ? 'Tâche ajoutée' : 'Demande envoyée à ' + pour);
}
async function toggleTask(id) {
  const t = TA.find(x => x.id === id); if (!t) return;
  t.fait = !t.fait; t.fait_le = t.fait ? nowIso() : null; t.fait_par = t.fait ? me.prenom : ''; t.retour_vu = !(t.fait && t.de && t.de !== me.prenom); t.maj = nowIso(); refreshCurrent();
  await persist({ table: 'taches', op: 'upsert', row: { ...t } }, () => { t.fait = !t.fait; refreshCurrent(); });
}
function tCardRender() {
  const t = TA.find(x => x.id === tOpen); if (!t) { tOpen = null; renderTaches(); return; }
  let arm = false;
  $('tCard').innerHTML = '<div class="card"><h2>Modifier</h2>' +
    '<label class="f">Intitulé<input id="e_titre" value="' + esc(t.titre) + '"></label>' +
    '<div class="row"><label class="f">Type<select id="e_type">' + TYPES.map(x => '<option' + (x === t.type ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label><label class="f">Structure<input id="e_client" list="tClients" value="' + esc(t.client || '') + '"></label></div>' +
    '<label class="f">Précisions<textarea id="e_detail" rows="4">' + esc(t.detail || '') + '</textarea></label>' +
    '<div class="row"><label class="f">Pour<select id="e_pour">' + pourOptions(t.pour) + '</select></label><label class="f">Pour quand<input type="date" id="e_date" value="' + esc(dateOnly(t.echeance)) + '"></label></div>' +
    '<div class="row" style="justify-content:space-between"><button id="e_del">Supprimer</button><div class="row"><button id="e_close">Fermer</button><button class="primary" id="e_save">Enregistrer</button></div></div></div>';
  $('e_close').onclick = () => { tOpen = null; renderTaches(); };
  $('e_del').onclick = async () => { if (!arm) { arm = true; $('e_del').textContent = 'Confirmer la suppression'; return; } TA = TA.filter(x => x.id !== t.id); tOpen = null; renderTaches(); await persist({ table: 'taches', op: 'delete', key: 'id', val: t.id }); };
  $('e_save').onclick = async () => { const pour = $('e_pour').value; Object.assign(t, { titre: $('e_titre').value.trim() || t.titre, type: $('e_type').value, client: $('e_client').value.trim(), detail: $('e_detail').value.trim(), pour, echeance: $('e_date').value || null, vu: pour === t.de || pour === me.prenom ? true : (pour === t.pour ? t.vu : false), maj: nowIso() }); tOpen = null; renderTaches(); if (await persist({ table: 'taches', op: 'upsert', row: { ...t } })) toast('Enregistré'); };
}

// ----- clients et devis (modifiables)
const ARCH = 'Archivés';
const rubriques = () => { const o = []; CLI.slice().sort((a, b) => a.ordre - b.ordre).forEach(r => { if (!o.includes(r.rubrique) && r.rubrique !== ARCH) o.push(r.rubrique); }); o.push(ARCH); return o; };
const ordreFor = rub => rub === ARCH ? 900 + CLI.filter(r => r.rubrique === ARCH).length : (() => { const s = CLI.filter(r => r.rubrique === rub); return s.length ? Math.max(...s.map(x => x.ordre)) + 1 : Math.max(0, ...CLI.filter(r => r.rubrique !== ARCH).map(x => x.ordre)) + 100; })();
function cItem(r) {
  const q = dateOnly(r.quand);
  return '<li><div><b>' + esc(r.structure) + '</b>' + (r.ou_on_en_est ? '<div class="small" style="white-space:pre-wrap">' + esc(r.ou_on_en_est) + '</div>' : '') + (r.prochaine_action ? '<div class="small" style="white-space:pre-wrap"><b>À faire :</b> ' + esc(r.prochaine_action) + '</div>' : '') +
    '<div class="muted small">' + esc([r.qui, r.contact].filter(Boolean).join(' · ')) + (r.maj_par ? ' · mis à jour par ' + esc(r.maj_par) + (r.maj ? ' le ' + fr(String(r.maj).slice(0, 10)) : '') : '') + '</div></div>' +
    (q ? dueChip(q) : r.quand ? '<span class="chip">' + esc(r.quand) + '</span>' : '') + (TRAVAIL_OK ? '<button data-treq="' + esc(r.structure) + '">Demande</button>' : '') + (CLI_EDIT ? '<button data-copen="' + r.id + '">Modifier</button>' : '') + '</li>';
}
function renderClients() {
  $('cMain').hidden = cOpen !== null; $('cCard').hidden = cOpen === null; if (cOpen !== null) return;
  $('cliDate').textContent = INFOS.clients_maj ? 'Repris du suivi du ' + fr(INFOS.clients_maj) : '';
  $('cAdd').hidden = !CLI_EDIT; $('cNote').hidden = CLI_EDIT;
  const f = ls.cf || 'mes', act = CLI.filter(r => r.rubrique !== ARCH), mine = act.filter(r => isMe(r.qui)), arch = CLI.filter(r => r.rubrique === ARCH);
  seg('cSeg', [['mes', 'Mes actions', mine.length], ['tous', 'Tous les clients', act.length], ['arch', 'Archivés', arch.length]], f);
  const rows = f === 'mes' ? mine : f === 'arch' ? arch : act;
  let res = []; try { res = JSON.parse(INFOS.resume || '[]'); } catch (e) {}
  $('cResumeD').hidden = f !== 'tous' || !res.length; $('resume').innerHTML = '<ul class="list">' + res.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>';
  const secs = []; rows.slice().sort((a, b) => a.ordre - b.ordre).forEach(r => { let s = secs.find(x => x.t === r.rubrique); if (!s) secs.push(s = { t: r.rubrique, rows: [] }); s.rows.push(r); });
  $('cliSecs').innerHTML = secs.map(s => '<div class="panel"><h2>' + esc(s.t) + '</h2><ul class="list">' + s.rows.map(cItem).join('') + '</ul></div>').join('') || '<div class="panel muted">' + (f === 'mes' ? 'Aucune action pour vous en ce moment.' : 'Rien ici.') + '</div>';
}
function cCardRender() {
  const isNew = cOpen === 'new';
  const r = isNew ? { rubrique: rubriques()[0], structure: '', ou_on_en_est: '', prochaine_action: '', qui: me.prenom || '', quand: '', contact: '' } : CLI.find(x => x.id === cOpen);
  if (!r) { cOpen = null; renderClients(); return; }
  const q = dateOnly(r.quand);
  $('cCard').innerHTML = '<div class="card"><h2>' + (isNew ? 'Nouvelle structure' : 'Modifier') + '</h2>' +
    '<label class="f">Structure<input id="c_str" value="' + esc(r.structure) + '"></label>' +
    '<label class="f">Rubrique<select id="c_rub">' + rubriques().map(x => '<option' + (x === r.rubrique ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
    '<label class="f">Où on en est<textarea id="c_ou" rows="3">' + esc(r.ou_on_en_est) + '</textarea></label>' +
    '<label class="f">Prochaine action<textarea id="c_pa" rows="3">' + esc(r.prochaine_action) + '</textarea></label>' +
    '<div class="row"><label class="f">Qui<input id="c_qui" list="c_quiL" value="' + esc(r.qui) + '"><datalist id="c_quiL">' + Object.values(MEMBRES).map(p => '<option value="' + esc(p) + '">').join('') + '<option value="Alexandre → Antoine"></datalist></label>' +
    '<label class="f">Quand (date)<input type="date" id="c_date" value="' + esc(q) + '"></label><label class="f">ou texte libre<input id="c_txt" value="' + esc(q ? '' : r.quand) + '"></label></div>' +
    '<label class="f">Contact<textarea id="c_ct" rows="2">' + esc(r.contact) + '</textarea></label>' +
    '<div class="row" style="justify-content:flex-end"><button id="c_close">Fermer</button><button class="primary" id="c_save">Enregistrer</button></div></div>';
  $('c_close').onclick = () => { cOpen = null; renderClients(); };
  $('c_save').onclick = async () => {
    const row = { rubrique: $('c_rub').value, structure: $('c_str').value.trim(), ou_on_en_est: $('c_ou').value.trim(), prochaine_action: $('c_pa').value.trim(), qui: $('c_qui').value.trim(), quand: $('c_date').value || $('c_txt').value.trim(), contact: $('c_ct').value.trim(), maj: nowIso(), maj_par: me.prenom };
    if (!row.structure) { toast('Indiquez le nom de la structure.'); return; }
    $('c_save').disabled = true;
    if (isNew) { row.ordre = ordreFor(row.rubrique); const { data, error } = await sb.from('clients').insert(row).select().single(); if (error || !data) { toast('Enregistrement impossible pour le moment : réessayez.'); $('c_save').disabled = false; return; } CLI.push(data); }
    else { row.id = r.id; row.ordre = row.rubrique === r.rubrique ? r.ordre : ordreFor(row.rubrique); const old = { ...r }; Object.assign(r, row); if (!await persist({ table: 'clients', op: 'upsert', row: { ...r } }, () => Object.assign(r, old))) { $('c_save').disabled = false; return; } }
    cOpen = null; renderClients(); toast('Enregistré');
  };
}
function dlCsv(name, lines) { const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(l.href), 4000); }
function exportClients() { dlCsv('clients_2A_Travail_' + today + '.csv', [['Rubrique', 'Structure', 'Où on en est', 'Prochaine action', 'Qui', 'Quand', 'Contact', 'Mis à jour par', 'Mis à jour le'].join(';')].concat(CLI.slice().sort((a, b) => a.ordre - b.ordre).map(r => [r.rubrique, r.structure, r.ou_on_en_est, r.prochaine_action, r.qui, r.quand, r.contact, r.maj_par, r.maj ? String(r.maj).slice(0, 10) : ''].map(csvCell).join(';')))); toast('Clients exportés'); }

// ----- formations
const FSTAT = ['À préparer', 'Dates fixées', 'En cours', 'Terminée', 'Annulée'];
const FTEMPLATE = ['Convention signée reçue', 'Dates, lieu et nombre de participants confirmés', 'Programme et fiche pédagogique du devis signé retrouvés', 'Liste des participants et questionnaires reçus', 'Documents de session préparés (convocations, émargements)', 'Documents contrôlés par Antoine ou Alexandre (intitulé, dates, horaires, lieu, prix, objectifs)', 'Documents envoyés au client', 'Formation réalisée', 'Émargements et évaluations récupérés', 'Certificats et attestations envoyés', 'Facture émise'];
const fItems = id => FI.filter(i => i.formation_id === id).sort((a, b) => a.ordre - b.ordre);
const fDates = f => f.dates_txt || (f.date_debut ? fr(f.date_debut) + (f.date_fin && f.date_fin !== f.date_debut ? ' au ' + fr(f.date_fin) : '') : 'Dates à fixer');
const fActive = f => f.statut !== 'Terminée' && f.statut !== 'Annulée';
const fSort = (a, b) => (a.date_debut || '9999').localeCompare(b.date_debut || '9999') || (a.cree_le || '').localeCompare(b.cree_le || '');
const fNext = f => fItems(f.id).find(i => !i.fait);
function fBlock(f) {
  const it = fItems(f.id), d = it.filter(i => i.fait).length, nx = fNext(f);
  return '<div class="panel"><div class="row" style="justify-content:space-between"><h2>' + esc(f.intitule) + '</h2><span class="chip">' + esc(f.statut) + '</span></div><div class="muted">' + esc([f.client, fDates(f), f.lieu].filter(Boolean).join(' · ')) + (f.responsable ? ' · Responsable : ' + esc(f.responsable) : '') + '</div>' +
    '<div class="gauge" style="margin:10px 0"><i style="width:' + (it.length ? d / it.length * 100 : 0) + '%"></i></div><div class="row" style="justify-content:space-between"><span class="small">' + d + ' / ' + it.length + ' étapes' + (nx ? ' · <b>Prochaine :</b> ' + esc(nx.libelle) : it.length ? ' · tout est fait' : '') + '</span><button data-fopen="' + esc(f.id) + '">Ouvrir</button></div></div>';
}
function renderFormations() {
  $('fMissing').hidden = TRAVAIL_OK; $('fMain').hidden = !TRAVAIL_OK || !!fOpen; $('fCard').hidden = !fOpen; if (!TRAVAIL_OK || fOpen) return;
  const act = FO.filter(fActive).sort(fSort), fin = FO.filter(f => !fActive(f)).sort((a, b) => fSort(b, a));
  $('fList').innerHTML = (act.map(fBlock).join('') || '<div class="panel muted">Aucune formation en cours. Ajoutez la première avec le bouton ci-dessus.</div>') + (fin.length ? '<details class="panel"><summary><b>Terminées ou annulées</b> <span class="muted small">' + fin.length + '</span></summary><div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">' + fin.map(fBlock).join('') + '</div></details>' : '');
}
async function fCreate() {
  const f = { id: uid(), intitule: 'Nouvelle formation', client: '', dates_txt: '', date_debut: null, date_fin: null, lieu: '', participants: '', responsable: me.prenom || '', statut: 'À préparer', notes: '', cree_le: nowIso(), maj: nowIso() };
  const items = FTEMPLATE.map((l, i) => ({ id: uid(), formation_id: f.id, libelle: l, ordre: i + 1, fait: false, fait_le: null, fait_par: '' }));
  FO.push(f); FI.push(...items); fOpen = f.id; location.hash = 'formations'; renderFormations(); fCardRender();
  if (await persist({ table: 'formations', op: 'upsert', row: { ...f } }, () => { FO = FO.filter(x => x.id !== f.id); FI = FI.filter(i => i.formation_id !== f.id); fOpen = null; renderFormations(); })) await persist({ table: 'formation_items', op: 'upsert', row: items.map(i => ({ ...i })) });
}
function fItemsHtml(f) { return fItems(f.id).map(i => '<li><button class="chk' + (i.fait ? ' on' : '') + '" data-fitem="' + esc(i.id) + '" aria-label="' + (i.fait ? 'Décocher' : 'Cocher') + '">' + (i.fait ? '✓' : '') + '</button><div><span' + (i.fait ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' + esc(i.libelle) + '</span>' + (i.fait && i.fait_par ? '<div class="muted small">fait par ' + esc(i.fait_par) + (i.fait_le ? ' le ' + fr(i.fait_le.slice(0, 10)) : '') + '</div>' : '') + '</div><button data-fdel="' + esc(i.id) + '" aria-label="Retirer cette étape">×</button></li>').join(''); }
function fCardRender() {
  const f = FO.find(x => x.id === fOpen); if (!f) { fOpen = null; renderFormations(); return; }
  let arm = false;
  $('fCard').innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><h2>Formation</h2><button id="f_close">Retour à la liste</button></div>' +
    '<label class="f">Intitulé<input id="f_int" value="' + esc(f.intitule) + '"></label><label class="f">Structure cliente<input id="f_cli" list="tClients" value="' + esc(f.client) + '"></label>' +
    '<div class="row"><label class="f">Dates (texte)<input id="f_dt" value="' + esc(f.dates_txt) + '" placeholder="ex. 26-27/11 + 14/12/2026"></label><label class="f">Premier jour<input type="date" id="f_d1" value="' + esc(dateOnly(f.date_debut)) + '"></label><label class="f">Dernier jour<input type="date" id="f_d2" value="' + esc(dateOnly(f.date_fin)) + '"></label></div>' +
    '<div class="row"><label class="f">Lieu<input id="f_lieu" value="' + esc(f.lieu) + '"></label><label class="f">Participants<input id="f_part" value="' + esc(f.participants) + '"></label></div>' +
    '<div class="row"><label class="f">Responsable<select id="f_resp"><option value="">—</option>' + pourOptions(f.responsable) + '</select></label><label class="f">Statut<select id="f_stat">' + FSTAT.map(x => '<option' + (x === f.statut ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label></div>' +
    '<label class="f">Notes<textarea id="f_notes" rows="3">' + esc(f.notes) + '</textarea></label>' +
    '<div class="row" style="justify-content:space-between"><button id="f_del">Supprimer la formation</button><button class="primary" id="f_save">Enregistrer</button></div>' +
    '<h3 style="margin-top:8px">Étapes</h3><ul class="list" id="fItems"></ul>' +
    '<div class="row"><label class="f" style="flex:3 1 220px">Ajouter une étape<input id="f_new" autocomplete="off"></label><button id="f_addi">Ajouter</button></div></div>';
  $('fItems').innerHTML = fItemsHtml(f);
  $('f_close').onclick = () => { fOpen = null; renderFormations(); };
  $('f_save').onclick = async () => { const d1 = $('f_d1').value, d2 = $('f_d2').value; Object.assign(f, { intitule: $('f_int').value.trim() || f.intitule, client: $('f_cli').value.trim(), dates_txt: $('f_dt').value.trim(), date_debut: d1 || null, date_fin: d2 || null, lieu: $('f_lieu').value.trim(), participants: $('f_part').value.trim(), responsable: $('f_resp').value, statut: $('f_stat').value, notes: $('f_notes').value.trim(), maj: nowIso() }); if (await persist({ table: 'formations', op: 'upsert', row: { ...f } })) toast('Enregistré'); };
  $('f_del').onclick = async () => { if (!arm) { arm = true; $('f_del').textContent = 'Confirmer la suppression'; return; } FO = FO.filter(x => x.id !== f.id); FI = FI.filter(i => i.formation_id !== f.id); fOpen = null; renderFormations(); await persist({ table: 'formations', op: 'delete', key: 'id', val: f.id }); };
  $('f_addi').onclick = async () => { const l = $('f_new').value.trim(); if (!l) return; const it = { id: uid(), formation_id: f.id, libelle: l, ordre: Math.max(0, ...fItems(f.id).map(i => i.ordre)) + 1, fait: false, fait_le: null, fait_par: '' }; FI.push(it); $('f_new').value = ''; $('fItems').innerHTML = fItemsHtml(f); await persist({ table: 'formation_items', op: 'upsert', row: { ...it } }); };
  $('fItems').onclick = async e => {
    const c = e.target.closest('[data-fitem]'), d = e.target.closest('[data-fdel]');
    if (c) { const i = FI.find(x => x.id === c.dataset.fitem); if (!i) return; i.fait = !i.fait; i.fait_le = i.fait ? nowIso() : null; i.fait_par = i.fait ? me.prenom : ''; $('fItems').innerHTML = fItemsHtml(f); await persist({ table: 'formation_items', op: 'upsert', row: { ...i } }, () => { i.fait = !i.fait; $('fItems').innerHTML = fItemsHtml(f); }); }
    if (d) { FI = FI.filter(x => x.id !== d.dataset.fdel); $('fItems').innerHTML = fItemsHtml(f); await persist({ table: 'formation_items', op: 'delete', key: 'id', val: d.dataset.fdel }); }
  };
}

// ----- notes et décisions
function renderNotes() {
  $('nMissing').hidden = TRAVAIL_OK; $('nMain').hidden = !TRAVAIL_OK; if (!TRAVAIL_OK) return;
  const f = ls.nf || 'tout'; seg('nSeg', [['tout', 'Tout', NO.length], ['dec', 'Décisions', NO.filter(n => n.decision).length]], f);
  const l = NO.filter(n => f === 'tout' || n.decision).slice().sort((a, b) => (b.cree_le || '').localeCompare(a.cree_le || '')).slice(0, 80);
  $('nList').innerHTML = l.map(n => '<li><div><div class="small"><b>' + esc(n.auteur) + '</b> · ' + esc(fdt(n.cree_le)) + (n.decision ? ' <span class="chip ok">Décision</span>' : '') + '</div><div style="white-space:pre-wrap">' + esc(n.texte) + '</div></div>' + (n.auteur === me.prenom ? '<button data-ndel="' + esc(n.id) + '">' + (nArm === n.id ? 'Confirmer' : 'Supprimer') + '</button>' : '') + '</li>').join('') || '<li class="muted">Rien pour l’instant.</li>';
}

// ----- accueil « Mon jour »
function renderMonJour() {
  $('mjDate').textContent = TODAY.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('mjHello').textContent = 'Bonjour' + (me.prenom ? ' ' + me.prenom : '');
  updateBadge();
  const calls = allCalls(), goal = +(ls.goal || 150), mine = calls.filter(x => x.a.date === today && isMine(x.a)).length;
  const reste = ALL.filter(toCall).length + (CAMP_OK ? KL.filter(c => kCible(c) && !kDone(c) && kTel(c)).length : 0);
  $('mjCallN').textContent = reste; $('mjCallS').textContent = 'à appeler · ' + mine + ' appel' + (mine > 1 ? 's' : '') + ' aujourd’hui sur ' + goal;
  const mt = TRAVAIL_OK ? incoming() : [], late = mt.filter(t => dateOnly(t.echeance) && dateOnly(t.echeance) < today).length, nw = TRAVAIL_OK ? unseen().length : 0;
  $('mjTaskN').textContent = TRAVAIL_OK ? mt.length : '–'; $('mjTaskS').textContent = !TRAVAIL_OK ? 'bientôt disponible' : nw ? nw + ' nouvelle' + (nw > 1 ? 's' : '') + ' demande' + (nw > 1 ? 's' : '') : late ? 'à faire · ' + late + ' en retard' : 'à faire';
  $('mjTaskCard').classList.toggle('hot', nw > 0);
  const ca = CLI.filter(r => r.rubrique !== ARCH && isMe(r.qui)), cl = ca.filter(r => dateOnly(r.quand) && dateOnly(r.quand) <= today).length;
  $('mjCliN').textContent = ca.length; $('mjCliS').textContent = cl ? 'actions pour moi · ' + cl + ' à faire maintenant' : 'actions pour moi';
  const items = [];
  if (TRAVAIL_OK) unseen().filter(t => t.pour === me.prenom).forEach(t => items.push('<li><div><b>Nouvelle demande de ' + esc(t.de) + '</b><div class="small">' + esc(t.titre) + (t.detail ? ' · ' + esc(t.detail.slice(0, 80)) : '') + '</div></div>' + dueChip(dateOnly(t.echeance)) + '<a class="btn primary" href="#taches">Voir</a></li>'));
  if (TRAVAIL_OK) mt.filter(t => !unseen().includes(t) && dateOnly(t.echeance) && dateOnly(t.echeance) <= today).forEach(t => items.push('<li><button class="chk" data-tdone="' + esc(t.id) + '" aria-label="Marquer comme fait"></button><div><b>' + esc(t.titre) + '</b><div class="muted small">De ' + esc(t.de || '') + '</div></div>' + dueChip(dateOnly(t.echeance)) + '</li>'));
  calls.filter(x => x.a.rappel && x.a.rappel <= today).forEach(x => items.push('<li><div><b>Rappeler ' + esc(x.nom) + '</b><div class="muted small">' + esc(depTxt(x.dep)) + '</div></div><span class="chip ' + (x.a.rappel < today ? 'late' : 'soon') + '">' + fr(x.a.rappel) + '</span>' + openBtn(x).replace('Ouvrir la fiche', 'Fiche') + '</li>'));
  ca.filter(r => dateOnly(r.quand) && dateOnly(r.quand) <= today).forEach(r => items.push('<li><div><b>' + esc(r.structure) + '</b><div class="small">' + esc(r.prochaine_action || r.ou_on_en_est) + '</div></div>' + dueChip(dateOnly(r.quand)) + '<a class="btn" href="#clients">Clients</a></li>'));
  $('mjList').innerHTML = items.slice(0, 8).join('') + (items.length > 8 ? '<li class="muted small">Et ' + (items.length - 8) + ' autres.</li>' : '') || '<li class="muted">Rien d’urgent aujourd’hui.</li>';
  const nf = TRAVAIL_OK ? FO.filter(f => fActive(f) && (!f.date_fin || f.date_fin >= today) && !(f.date_debut && f.date_debut < today && !f.date_fin)).sort(fSort)[0] : null;
  $('mjFormP').hidden = !TRAVAIL_OK;
  $('mjForm').innerHTML = nf ? '<div class="row" style="justify-content:space-between"><div><b>' + esc(nf.intitule) + '</b><div class="muted small">' + esc([nf.client, fDates(nf)].filter(Boolean).join(' · ')) + '</div>' + (fNext(nf) ? '<div class="small" style="margin-top:6px"><b>Prochaine étape :</b> ' + esc(fNext(nf).libelle) + '</div>' : '') + '</div><button data-fopen="' + esc(nf.id) + '">Ouvrir</button></div>' : '<span class="muted">Aucune formation à venir enregistrée.</span>';
  $('mjNotesP').hidden = !TRAVAIL_OK;
  $('mjNotes').innerHTML = TRAVAIL_OK ? NO.slice().sort((a, b) => (b.cree_le || '').localeCompare(a.cree_le || '')).slice(0, 3).map(n => '<li><div><div class="small"><b>' + esc(n.auteur) + '</b> · ' + esc(fdt(n.cree_le)) + (n.decision ? ' <span class="chip ok">Décision</span>' : '') + '</div><div style="white-space:pre-wrap">' + esc(n.texte.slice(0, 160)) + '</div></div></li>').join('') || '<li class="muted">Aucun message.</li>' : '';
}

function initTravail() {
  document.addEventListener('click', e => {
    let b;
    if ((b = e.target.closest('[data-tdone]'))) toggleTask(b.dataset.tdone);
    else if ((b = e.target.closest('[data-topen]'))) { tOpen = b.dataset.topen; renderTaches(); tCardRender(); }
    else if ((b = e.target.closest('[data-copen]'))) { cOpen = +b.dataset.copen; location.hash = 'clients'; renderClients(); cCardRender(); }
    else if ((b = e.target.closest('[data-treq]'))) { prefill = { client: b.dataset.treq, type: 'Devis' }; location.hash = 'taches'; }
    else if ((b = e.target.closest('[data-fopen]'))) { fOpen = b.dataset.fopen; location.hash = 'formations'; renderFormations(); fCardRender(); }
  });
  $('tAdd').addEventListener('submit', e => { e.preventDefault(); addTask(); });
  $('tType').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; tType = b.dataset.t; fillTForm(); });
  $('tSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ls.tf = b.dataset.f; save(); renderTaches(); } });
  $('tNotif').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (e) {} renderTaches(); });
  $('cSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ls.cf = b.dataset.f; save(); renderClients(); } });
  $('cAdd').addEventListener('click', () => { cOpen = 'new'; renderClients(); cCardRender(); });
  $('cExport').addEventListener('click', exportClients);
  $('fAdd').addEventListener('click', fCreate);
  $('nAdd').addEventListener('submit', async e => { e.preventDefault(); const texte = $('nTexte').value.trim(); if (!texte) return; const row = { id: uid(), texte, decision: $('nDec').checked, auteur: me.prenom, cree_le: nowIso() }; NO.push(row); $('nTexte').value = ''; $('nDec').checked = false; renderNotes(); await persist({ table: 'notes', op: 'upsert', row: { ...row } }, () => { NO = NO.filter(x => x.id !== row.id); renderNotes(); }); });
  $('nSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ls.nf = b.dataset.f; save(); renderNotes(); } });
  $('nList').addEventListener('click', async e => { const b = e.target.closest('[data-ndel]'); if (!b) return; const id = b.dataset.ndel; if (nArm !== id) { nArm = id; renderNotes(); return; } nArm = null; NO = NO.filter(x => x.id !== id); renderNotes(); await persist({ table: 'notes', op: 'delete', key: 'id', val: id }); });
}

// ---------- branchements
let viewsReady = false;
function initViews() { if (viewsReady) return; viewsReady = true;
  const REGS = [...new Set(ALL.map(c => c.reg))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('selReg').innerHTML = REGS.map(r => '<option>' + esc(r) + '</option>').join('');
  if (ls.reg && REGS.includes(ls.reg)) $('selReg').value = ls.reg;
  geoReady.then(fillDeps);
  ['selReg', 'selDep', 'selList'].forEach(id => $(id).addEventListener('change', () => { if (id === 'selReg') { ls.reg = $('selReg').value; ls.dep = ''; save(); fillDeps(); } else { if (id === 'selDep') { ls.dep = $('selDep').value; save(); } poolInfo(); } }));
  $('go').addEventListener('click', () => { findMode = $('selList').value === 'N'; if (findMode && !NUM_OK) { findMode = false; toast('L’enregistrement des numéros n’est pas encore activé.'); return; } single = null; Q = pool().map(c => c.id); qi = 0; renderCard(); });
  $('goalSel').addEventListener('change', e => { ls.goal = +e.target.value; save(); renderBilan(); });
  document.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSingle(b.dataset.open); });
  if (CAMP_OK) {
    const KR = [...new Set(KL.map(c => c.reg))].sort((a, b) => a.localeCompare(b, 'fr'));
    $('kReg').innerHTML = '<option value="">Toutes</option>' + KR.map(r => '<option>' + esc(r) + '</option>').join('');
    ['kList', 'kReg'].forEach(id => $(id).addEventListener('change', renderCampagne));
    $('kSearch').addEventListener('input', renderCampagne);
    $('kGo').addEventListener('click', () => { const q = kPool().filter(c => !kDone(c)).map(c => c.id); if (q.length) kOpenCard(q[0], q); else toast('Personne à appeler dans cette sélection.'); });
    $('kUndo').addEventListener('click', kDoUndo);
    document.addEventListener('click', e => { const b = e.target.closest('[data-kopen]'); if (b) kOpenCard(b.dataset.kopen, kPool().map(c => c.id)); });
  }
  $('gSearch').addEventListener('input', renderSearch);
  $('exGo').addEventListener('click', exportCsv);
  addEventListener('keydown', e => { // 1 à 9 : résultat ; Entrée (ou Ctrl+Entrée dans une zone de saisie) : enregistrer
    if (e.altKey || e.metaKey) return;
    const t = e.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName), onBtn = t && /^(BUTTON|A)$/.test(t.tagName);
    const vis = x => x && x.offsetParent !== null;
    const res = vis($('resBtns')) ? $('resBtns') : vis($('kRes')) ? $('kRes') : null; if (!res) return;
    const ok = res === $('resBtns') ? $('ok') : $('kOk');
    if (e.key === 'Enter' && (typing ? e.ctrlKey : (!onBtn || res.contains(t))) && ok && !ok.disabled) { e.preventDefault(); ok.click(); return; }
    if (!typing && !e.ctrlKey && /^[1-9]$/.test(e.key)) { const b = res.querySelectorAll('button')[+e.key - 1]; if (b) b.click(); }
  });
  initTravail(); }
})();
