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
const RES = {
  R: [['Joint – intéressé (RDV)', 'g'], ['Joint – à rappeler', 'w'], ['Message laissé', 'n'], ['Transmis au standard', 'n'], ['Pas intéressé', 'b'], ['Mauvais numéro', 'b'], ['Injoignable', 'n']],
  S: [['Adresse mail obtenue', 'g'], ['Joint – intéressé (RDV)', 'g'], ['Joint – à rappeler', 'w'], ['Message laissé', 'n'], ['Transmis au standard', 'n'], ['Pas intéressé', 'b'], ['Mauvais numéro', 'b'], ['Injoignable', 'n']] };
const NEEDDATE = ['Joint – intéressé (RDV)', 'Joint – à rappeler'];
const RETRY = ['Message laissé', 'Injoignable', 'Transmis au standard'];
function fromRow(r) { return { res: r.resultat, date: r.date_appel, pers: r.personne || '', note: r.note || '', suite: r.suite || '', rappel: r.rappel || '', mail: r.mail_obtenu || '', par: r.par || '', hist: r.hist || [] }; }
function toRow(id, a) { return { etab_id: id, resultat: a.res, date_appel: a.date, personne: a.pers, note: a.note, suite: a.suite || '', rappel: a.rappel || null, mail_obtenu: a.mail || '', par: a.par, hist: a.hist || [], maj: new Date().toISOString() }; }
async function fetchAll(table, order) {
  const out = []; let from = 0;
  for (;;) { const { data, error } = await sb.from(table).select('*').order(order).range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}
const nom = p => (MEMBRES[(p || '').toLowerCase()] || p || 'Quelqu’un');
function done(c) { const a = A[c.id]; if (!a) return false; if (a.rappel && a.rappel <= today) return false; if (RETRY.includes(a.res) && a.date && a.date <= addDays(-7)) return false; return true; }
function toCall(c) { return c.tel && !done(c); }

async function boot() {
  started = true; $('loginZone').hidden = true; $('appZone').hidden = false; status('Chargement des données…');
  try {
    const { data: { user } } = await sb.auth.getUser(); me.email = (user && user.email || '').toLowerCase();
    const [mem, etab, app, cli, inf] = await Promise.all([fetchAll('membres', 'email'), fetchAll('etablissements', 'id'), fetchAll('appels', 'etab_id'), fetchAll('clients', 'ordre'), fetchAll('infos', 'cle')]);
    if (!mem.length) { status(''); showLogin('Cette adresse n’est pas autorisée. Demandez à Alexandre de l’ajouter.'); await sb.auth.signOut(); return; }
    mem.forEach(m => MEMBRES[m.email.toLowerCase()] = m.prenom); me.prenom = MEMBRES[me.email] || '';
    etab.forEach(e => C[e.id] = { id: e.id, k: e.genre, reg: e.region || 'Non précisé', dep: e.dep || '', nom: e.nom, qui: e.interlocuteur || '', tel: e.tel || '', mail: e.email || '', env: e.date_mail || '', ech: !!e.mail_en_echec, type: e.type || '', gest: e.gestionnaire || '', ville: e.ville || '', asso: e.asso_contactee || '' });
    ALL = Object.values(C); A = {}; app.forEach(r => A[r.etab_id] = fromRow(r));
    CLI = cli; inf.forEach(i => INFOS[i.cle] = i.valeur);
    await loadCampagne();
    status(''); initViews(); route();
    sb.channel('appels').on('postgres_changes', { event: '*', schema: 'public', table: 'appels' }, p => {
      if (p.eventType === 'DELETE') delete A[p.old.etab_id]; else A[p.new.etab_id] = fromRow(p.new);
      refreshCurrent();
    }).subscribe();
    if (CAMP_OK) sb.channel('campagne_appels').on('postgres_changes', { event: '*', schema: 'public', table: 'campagne_appels' }, p => {
      if (p.eventType === 'DELETE') delete KA[p.old.cible_id]; else KA[p.new.cible_id] = kFromRow(p.new);
      refreshCurrent();
    }).subscribe();
  } catch (e) { status('Les données ne peuvent pas être chargées pour le moment. Vérifiez la connexion internet puis rechargez la page.'); }
}

// ---------- vues
const VIEWS = ['accueil', 'seance', 'campagne', 'carte', 'clients'];
function route() {
  if (!ALL.length) return;
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'accueil';
  document.querySelectorAll('[data-view]').forEach(s => s.hidden = s.dataset.view !== v);
  document.querySelectorAll('nav a').forEach(a => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (v === 'carte') drawMap(); if (v === 'accueil') renderHome(); if (v === 'campagne') renderCampagne(); window.scrollTo(0, 0);
}
addEventListener('hashchange', () => { if (!recovering) route(); });
function refreshCurrent() { const v = location.hash.slice(1) || 'accueil'; if (v === 'accueil') renderHome(); if (v === 'carte') drawMap(); if (v === 'seance' && !Q.length) poolInfo(); if (v === 'campagne' && !kOpen) renderCampagne(); }

// ---------- accueil
const sess = { n: 0 };
function renderHome() {
  $('today').textContent = TODAY.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('hello').textContent = 'Bonjour' + (me.prenom ? ' ' + me.prenom : '');
  const goal = +(ls.goal || 15); $('goalSel').value = String(goal);
  $('goalTxt').textContent = sess.n + ' appel' + (sess.n > 1 ? 's' : '') + ' sur ' + goal + (sess.n >= goal ? ' : objectif atteint, bravo.' : '');
  $('gaugeBar').style.width = Math.min(100, sess.n / goal * 100) + '%';
  const vals = Object.entries(A); const wk = vals.filter(([k, a]) => a.date >= monday);
  const tot = vals.length, rdv = vals.filter(([k, a]) => a.res === 'Joint – intéressé (RDV)').length, adr = vals.filter(([k, a]) => a.res === 'Adresse mail obtenue').length;
  const reste = ALL.filter(toCall).length;
  $('weekStats').innerHTML = [['Appels cette semaine', wk.length], ['Rendez-vous obtenus', rdv], ['Adresses obtenues', adr], ['Restent à appeler', reste]].map(([l, v]) => '<div class="stat"><div class="big num">' + v + '</div><div class="muted small">' + l + '</div></div>').join('');
  const by = {}; wk.forEach(([k, a]) => { const p = nom(a.par); by[p] = (by[p] || 0) + 1; });
  $('byPerson').innerHTML = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([p, n]) => '<li><span>' + esc(p) + '</span><b class="num">' + n + '</b></li>').join('') || '<li class="muted">Aucun appel noté cette semaine.</li>';
  const rap = vals.filter(([k, a]) => a.rappel && C[k] && a.rappel <= addDays(7)).sort((a, b) => a[1].rappel.localeCompare(b[1].rappel));
  $('rapCount').textContent = rap.length ? rap.length + ' dans les 7 jours' : '';
  $('rappels').innerHTML = rap.slice(0, 30).map(([k, a]) => { const c = C[k]; const cl = a.rappel < today ? 'late' : a.rappel === today ? 'soon' : '';
    return '<li><div><b>' + esc(c.nom) + '</b><div class="muted small">' + esc(depLabel(c)) + (a.pers ? ' · ' + esc(a.pers) : '') + (a.suite ? ' · ' + esc(a.suite) : '') + '</div></div><span class="chip ' + cl + '">' + (a.rappel < today ? 'En retard · ' : '') + fr(a.rappel) + '</span><button data-open="' + k + '">Ouvrir la fiche</button></li>'; }).join('') || '<li class="muted">Rien à rappeler pour l’instant.</li>';
  const P = [[10, '10 appels'], [50, '50 appels'], [100, '100 appels'], [250, '250 appels'], [500, '500 appels']];
  const b = P.map(([n, l]) => [tot >= n, l, tot >= n ? 'Atteint' : 'Encore ' + (n - tot)]);
  b.push([rdv >= 1, 'Premier rendez-vous', rdv >= 1 ? 'Atteint' : 'À décrocher']); b.push([adr >= 10, '10 adresses obtenues', adr >= 10 ? 'Atteint' : 'Encore ' + Math.max(0, 10 - adr)]);
  $('badges').innerHTML = b.map(([on, l, s]) => '<div class="badge' + (on ? ' on' : '') + '"><b>' + l + '</b><span class="small">' + s + '</span></div>').join('');
}

// ---------- séance
let Q = [], qi = 0, undo = null, single = null;
function depLabel(c) { return (NAMES[c.dep] || c.dep) + (c.ville ? ' · ' + c.ville : ''); }
function fillDeps() { const r = $('selReg').value; const deps = [...new Set(ALL.filter(c => c.reg === r).map(c => c.dep))].sort();
  $('selDep').innerHTML = '<option value="">Tous</option>' + deps.map(d => '<option value="' + d + '">' + d + ' – ' + esc(NAMES[d] || '') + '</option>').join('');
  if (ls.dep && deps.includes(ls.dep)) $('selDep').value = ls.dep; poolInfo(); }
function pool() { const r = $('selReg').value, d = $('selDep').value, l = $('selList').value;
  const p = ALL.filter(c => c.reg === r && (!d || c.dep === d) && l.includes(c.k) && toCall(c));
  p.sort((a, b) => (a.k === b.k ? 0 : a.k === 'R' ? -1 : 1) || (b.env || '').localeCompare(a.env || '') || a.nom.localeCompare(b.nom, 'fr')); return p; }
function poolInfo() { const p = pool(); $('poolInfo').textContent = p.length ? p.length + ' établissement' + (p.length > 1 ? 's' : '') + ' à appeler dans cette sélection (les relances après mail passent en premier, les mails les plus récents d’abord).' : 'Personne à appeler dans cette sélection : choisissez une autre région ou une autre liste.'; }
function openSingle(id) { single = id; location.hash = 'seance'; setTimeout(renderCard, 0); }
function script(c) { const nm = me.prenom ? me.prenom + (me.prenom === 'Antoine' ? ' Gadiou' : me.prenom === 'Alexandre' ? ' Bigot' : me.prenom === 'Sybille' ? ' Deterpigny' : '') : 'Antoine Gadiou';
  const fin = '<p class="muted small">Aucun prix, aucun nom d’employeur, aucune situation réelle.</p>';
  if (c.k === 'R') return '<p>« Bonjour, ' + esc(nm) + ', de 2A Formation, organisme de formation du travail social certifié Qualiopi. ' + (c.env ? 'Je vous ai envoyé le ' + fr(c.env) + ' un mail ' : 'Je vous ai envoyé un mail ') + (c.qui ? 'à l’attention de ' + esc(c.qui) + ' ' : '') + 'au sujet de nos formations en intra pour les équipes. Pourriez-vous me passer la personne qui s’occupe du plan de formation ? »</p><p>Avec la bonne personne : « Nous sommes éducateurs spécialisés et nous construisons chaque formation avec l’équipe, à partir de ses besoins. Puis-je vous renvoyer notre catalogue et convenir d’un court échange ? »</p>' + fin;
  return '<p>« Bonjour, ' + esc(nm) + ', de 2A Formation, organisme de formation du travail social certifié Qualiopi. Nous proposons des formations en intra pour les équipes éducatives et je souhaiterais en adresser la présentation à la direction' + (c.type ? ' de votre ' + esc(c.type.toLowerCase()) : '') + '. À quelle adresse mail puis-je l’envoyer ? »</p><p>Si on vous la donne : notez-la (bien épelée) dans le champ prévu. Alexandre préparera le mail.</p>' + fin; }
function renderCard() { const z = $('cardZone'); const id = single || Q[qi];
  if (!id) { z.innerHTML = Q.length ? '<div class="card"><h2>Séance terminée</h2><p>' + sess.n + ' appel' + (sess.n > 1 ? 's' : '') + ' noté' + (sess.n > 1 ? 's' : '') + '. Merci !</p><div class="row"><a class="btn primary" href="#accueil">Revenir à l’accueil</a><button id="again">Nouvelle sélection</button></div></div>' : ''; const ag = $('again'); if (ag) ag.onclick = () => { Q = []; renderCard(); poolInfo(); }; return; }
  const c = C[id]; const a = A[id] || {}; const L = RES[c.k];
  z.innerHTML = '<div class="card">' +
    '<div class="row" style="justify-content:space-between"><span class="kind">' + (c.k === 'R' ? 'Relance après mail' : 'Sans adresse mail') + '</span><span class="muted small num">' + (single ? 'Fiche ouverte depuis l’accueil' : 'Appel ' + (qi + 1) + ' sur ' + Q.length) + '</span></div>' +
    '<div><h2>' + esc(c.nom) + '</h2><div class="muted">' + esc(depLabel(c)) + (c.k === 'S' && c.gest ? ' · ' + esc(c.gest) : '') + '</div></div>' +
    (c.qui ? '<div><span class="eyebrow">Mail adressé à</span><div>' + esc(c.qui) + '</div></div>' : '') +
    (c.ech ? '<div class="note small">L’adresse mail de cet établissement est en échec : demandez la bonne adresse pendant l’appel.</div>' : '') +
    (a.res ? '<div class="note small"><b>Appels précédents</b><br>' + fr(a.date) + ' : <b>' + esc(a.res) + '</b> (' + esc(nom(a.par)) + ')' + (a.pers ? ' · ' + esc(a.pers) : '') + (a.note ? ' – ' + esc(a.note) : '') + (a.hist || []).map(h => '<br>' + fr(h.date) + ' : ' + esc(h.res) + (h.note ? ' – ' + esc(h.note) : '')).join('') + '</div>' : '') +
    '<div class="row"><span class="tel num" id="telTxt">' + esc(c.tel) + '</span></div>' +
    '<div class="row"><a class="btn call" href="tel:' + esc(c.tel.replace(/\s/g, '')) + '">Appeler</a><button id="cp">Copier le numéro</button></div>' +
    '<details class="script" open><summary><b>Ce que je dis</b></summary>' + script(c) + '</details>' +
    '<div><div class="eyebrow" style="margin-bottom:8px">Résultat de l’appel</div><div class="res" id="resBtns">' + L.map(([r, t]) => '<button class="' + t + '" data-r="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div></div>' +
    '<div class="row" id="more">' +
      '<label class="f">Personne jointe<input id="fPers" autocomplete="off" placeholder="Nom, fonction"></label>' +
      '<label class="f" id="wDate" hidden>Date de rappel ou de rendez-vous<input type="date" id="fDate"></label>' +
      (c.k === 'S' ? '<label class="f" id="wMail" hidden>Adresse mail obtenue<input id="fMail" type="email" autocomplete="off"></label>' : '') +
      '<label class="f" style="flex-basis:100%">Mes notes pendant l’appel<textarea id="fNote" rows="4" placeholder="Qui j’ai eu, ce qui a été dit, la suite à donner…"></textarea></label>' +
    '</div>' +
    '<div class="row" style="justify-content:space-between"><div class="row">' + (undo ? '<button id="undo">Annuler le dernier</button>' : '') + '</div><div class="row">' + (single ? '<a class="btn" href="#accueil">Fermer</a>' : '<button id="skip">Passer</button>') + '<button class="primary" id="ok" disabled>Enregistrer et suivant</button></div></div>' +
    '</div>';
  let pick = null;
  try { const dn = (ls.drafts || {})[id]; if (dn) $('fNote').value = dn; } catch (e) {}
  $('fNote').addEventListener('input', () => { ls.drafts = ls.drafts || {}; ls.drafts[id] = $('fNote').value; save(); });
  $('cp').onclick = async () => { try { await navigator.clipboard.writeText(c.tel); toast('Numéro copié'); } catch (e) { const r = document.createRange(); r.selectNodeContents($('telTxt')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Numéro sélectionné : copiez-le'); } };
  $('resBtns').onclick = e => { const b = e.target.closest('button'); if (!b) return; pick = b.dataset.r;
    $('resBtns').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    const nd = NEEDDATE.includes(pick); $('wDate').hidden = !nd; if (nd && !$('fDate').value) $('fDate').value = addDays(pick === 'Joint – à rappeler' ? 7 : 3);
    if ($('wMail')) $('wMail').hidden = pick !== 'Adresse mail obtenue'; $('ok').disabled = false; };
  const sk = $('skip'); if (sk) sk.onclick = () => { qi++; renderCard(); };
  const un = $('undo'); if (un) un.onclick = doUndo;
  $('ok').onclick = () => record(c, pick);
}
async function record(c, res) { if (!res) return; const prev = A[c.id] ? JSON.parse(JSON.stringify(A[c.id])) : null;
  const hist = (prev && prev.res ? [{ res: prev.res, date: prev.date || '', par: prev.par || '', note: prev.note || '', pers: prev.pers || '' }].concat(prev.hist || []) : []).slice(0, 10);
  const body = { res, date: today, par: me.email, pers: $('fPers').value.trim(), note: $('fNote').value.trim(), suite: '', rappel: NEEDDATE.includes(res) ? ($('fDate').value || '') : '', mail: $('fMail') ? $('fMail').value.trim() : '', hist };
  $('ok').disabled = true;
  const { error } = await sb.from('appels').upsert(toRow(c.id, body));
  if (error) { toast('Enregistrement impossible pour le moment : réessayez dans un instant.'); $('ok').disabled = false; return; }
  A[c.id] = body; sess.n++; undo = { id: c.id, prev }; toast('Appel enregistré');
  if (ls.drafts && ls.drafts[c.id]) { delete ls.drafts[c.id]; save(); }
  if (single) { single = null; location.hash = 'accueil'; return; }
  qi++; renderCard(); }
async function doUndo() { if (!undo) return; const u = undo; undo = null;
  const { error } = u.prev ? await sb.from('appels').upsert(toRow(u.id, u.prev)) : await sb.from('appels').delete().eq('etab_id', u.id);
  if (error) { toast('Annulation impossible pour le moment.'); return; }
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
  $('depGo').onclick = () => { const any = ALL.find(x => x.dep === c); $('selReg').value = any.reg; ls.reg = any.reg; fillDeps(); $('selDep').value = c; ls.dep = c; $('selList').value = 'RS'; save(); poolInfo(); location.hash = 'seance'; single = null; Q = pool().map(x => x.id); qi = 0; setTimeout(renderCard, 0); }; }

// ---------- clients
function renderClients() { $('cliDate').textContent = INFOS.clients_maj ? 'Mis à jour le ' + fr(INFOS.clients_maj) : '';
  let res = []; try { res = JSON.parse(INFOS.resume || '[]'); } catch (e) {}
  $('resume').innerHTML = '<h2>En bref</h2><ul class="list">' + res.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>';
  const secs = []; CLI.forEach(r => { let s = secs.find(x => x.t === r.rubrique); if (!s) secs.push(s = { t: r.rubrique, rows: [] }); s.rows.push(r); });
  $('cliSecs').innerHTML = secs.map(s => '<div class="panel"><h2>' + esc(s.t) + '</h2><div class="tw" style="margin-top:10px"><table><thead><tr><th>Structure</th><th>Où on en est</th><th>Prochaine action</th><th>Qui</th><th>Quand</th><th>Contact</th></tr></thead><tbody>' +
    s.rows.map(r => { const q = /^\d{4}-/.test(r.quand) ? r.quand.slice(0, 10) : ''; const cl = q ? (q <= addDays(0) ? 'late' : q <= addDays(7) ? 'soon' : '') : ''; return '<tr><td><b>' + esc(r.structure) + '</b></td><td>' + esc(r.ou_on_en_est) + '</td><td>' + esc(r.prochaine_action) + '</td><td>' + esc(r.qui) + '</td><td>' + (q ? '<span class="chip ' + cl + '">' + fr(q) + '</span>' : esc(r.quand)) + '</td><td>' + esc(r.contact) + '</td></tr>'; }).join('') + '</tbody></table></div></div>').join(''); }

// ---------- campagne (mail 2Avenir) : d'abord les adresses en échec, puis les structures sans réponse au mail
let CAMP_OK = false, KL = [], KC = {}, KA = {}, kOpen = null, kQueue = [], kUndo = null;
const KRES = [['Adresse mail obtenue', 'g'], ['Mail bien reçu', 'g'], ['Joint – intéressé (RDV)', 'g'], ['Joint – à rappeler', 'w'], ['Message laissé', 'n'], ['Transmis au standard', 'n'], ['Pas intéressé', 'b'], ['Mauvais numéro', 'b'], ['Injoignable', 'n']];
const KWAIT = 7; // jours après l'envoi du mail avant d'appeler une structure qui n'a pas répondu
function kFromRow(r) { return { res: r.resultat, date: r.date_appel, pers: r.personne || '', note: r.note || '', rappel: r.rappel || '', mail: r.mail_obtenu || '', tel: r.tel_trouve || '', par: r.par || '', hist: r.hist || [] }; }
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
    '<div><div class="eyebrow" style="margin-bottom:8px">Résultat de l’appel</div><div class="res" id="kRes">' + KRES.map(([r, s]) => '<button class="' + s + '" data-r="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div></div>' +
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
  const body = { res, date: today, par: me.email, pers: $('kPers').value.trim(), note: $('kNote').value.trim(), rappel: $('kDate').value || '', mail: mail || (prev && prev.mail) || '', tel: ($('kTelIn') ? $('kTelIn').value.trim() : '') || (prev && prev.tel) || '', hist };
  $('kOk').disabled = true;
  const { error } = await sb.from('campagne_appels').upsert(kToRow(c.id, body));
  if (error) { toast('Enregistrement impossible pour le moment : réessayez dans un instant.'); $('kOk').disabled = false; return; }
  KA[c.id] = body; kUndo = { id: c.id, prev }; toast('Appel enregistré'); sess.n++;
  if (ls.kdrafts && ls.kdrafts[c.id]) { delete ls.kdrafts[c.id]; save(); }
  const pos = kQueue.indexOf(c.id);
  if (pos >= 0 && pos < kQueue.length - 1) kOpenCard(kQueue[pos + 1]); else { kOpen = null; renderCampagne(); } }
async function kDoUndo() { if (!kUndo) return; const u = kUndo; kUndo = null;
  const { error } = u.prev ? await sb.from('campagne_appels').upsert(kToRow(u.id, u.prev)) : await sb.from('campagne_appels').delete().eq('cible_id', u.id);
  if (error) { toast('Annulation impossible pour le moment.'); return; }
  if (u.prev) KA[u.id] = u.prev; else delete KA[u.id]; sess.n = Math.max(0, sess.n - 1); toast('Dernier appel annulé'); renderCampagne(); }

// ---------- branchements
let viewsReady = false;
function initViews() { if (viewsReady) return; viewsReady = true;
  const REGS = [...new Set(ALL.map(c => c.reg))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('selReg').innerHTML = REGS.map(r => '<option>' + esc(r) + '</option>').join('');
  if (ls.reg && REGS.includes(ls.reg)) $('selReg').value = ls.reg;
  geoReady.then(fillDeps);
  ['selReg', 'selDep', 'selList'].forEach(id => $(id).addEventListener('change', () => { if (id === 'selReg') { ls.reg = $('selReg').value; ls.dep = ''; save(); fillDeps(); } else { if (id === 'selDep') { ls.dep = $('selDep').value; save(); } poolInfo(); } }));
  $('go').addEventListener('click', () => { single = null; Q = pool().map(c => c.id); qi = 0; renderCard(); });
  $('goalSel').addEventListener('change', e => { ls.goal = +e.target.value; save(); renderHome(); });
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
  renderClients(); }
})();
