// 2A Travail – onglet « Émargement » (formateurs). Fichier séparé : n'utilise de app.js
// que sb (connexion Supabase), toast, esc et $, transmis par EMG.init(). Ne lit ni n'écrit aucune table directement :
// tout passe par les fonctions contrôlées public.emg_* (schéma « emargement » verrouillé).
'use strict';
const EMG = (() => {
  const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const PERIODE = { matin: 'Matin', apres_midi: 'Après-midi' };
  const ETAT = { preparee: ['Préparée', ''], ouverte: ['Ouverte', 'soon'], cloturee: ['Clôturée', 'ok'], papier: ['Sur papier', ''] };
  const OBS = { arrivee: 'Arrivée à', depart: 'Départ à', absence_signalee: 'Absence signalée' };
  let sb, toast, esc, $;
  let data = null, ouverte = null, det = null, minuterie = null, vue = 'liste', enCours = false, qrPret = null;

  // ---------- outils
  const z = () => $('v-emargement');
  const hfr = t => String(t || '').replace(/^0/, '').replace(':', 'h');
  const jourCourt = j => { const d = new Date(j + 'T12:00:00'); return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }); };
  const jourLong = j => { const s = new Date(j + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const heure = t => t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '';
  const quand = t => t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(' ', ' à ') : '';
  const lienSigner = jeton => new URL('signer.html#t=' + jeton, location.href).href;
  const lienCourt = () => new URL('e', location.href).href.replace(/^https?:\/\//, '');
  const chip = e => '<span class="chip ' + ETAT[e][1] + '">' + ETAT[e][0] + '</span>';
  const memo = (k, v) => { try { if (v === undefined) return JSON.parse(sessionStorage.getItem('emg_' + k) || 'null'); sessionStorage.setItem('emg_' + k, JSON.stringify(v)); } catch (e) { return null; } };
  const msgErr = e => (e && (e.message || e.details)) || 'Action impossible pour le moment.';

  async function rpc(nom, args) {
    const { data: d, error } = await sb.rpc(nom, args || {});
    if (error) throw error;
    return d;
  }
  async function action(btn, fn) {
    if (enCours) return; enCours = true; if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { toast(msgErr(e)); } finally { enCours = false; if (btn) btn.disabled = false; }
  }
  function arreter() { clearInterval(minuterie); minuterie = null; }

  // ---------- styles propres à l'onglet
  const css = document.createElement('style');
  css.textContent = `
  .emg-dj{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--line)}
  .emg-dj:last-child{border-bottom:0}
  .emg-qr{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
  .emg-qr .qr{background:#fff;padding:14px;border-radius:14px;width:min(78vw,420px);aspect-ratio:1;display:flex;align-items:center;justify-content:center}
  .emg-qr .qr svg,.emg-qr .qr img{width:100%;height:100%}
  .emg-code{font-family:var(--f-data);font-size:clamp(34px,9vw,56px);letter-spacing:.18em;font-weight:500}
  .emg-compteur{font-family:var(--f-display);font-weight:800;font-size:clamp(30px,7vw,44px)}
  .emg-pad{position:relative;background:#fff;border:2px dashed var(--line);border-radius:14px;height:200px;touch-action:none}
  .emg-pad canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
  .emg-pad .ind{position:absolute;left:0;right:0;bottom:10px;text-align:center;color:#7c8a86;font-size:14px;pointer-events:none}
  .emg-plein{position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto;padding:calc(14px + env(safe-area-inset-top,0px)) 16px calc(20px + env(safe-area-inset-bottom,0px))}
  .emg-plein .in{max-width:620px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  .emg-obs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .emg-obs select,.emg-obs input{padding:6px 8px}
  .emg-ok{color:var(--ok);font-weight:700}.emg-abs{color:var(--bad);font-weight:700}
  .emg-big{min-height:54px;font-size:17px;justify-content:center}
  @media (max-width:760px){nav.tabs .links:has(a[data-v="emargement"]:not([hidden])) a{font-size:10.5px!important;letter-spacing:-.02em}}
  `;
  document.head.appendChild(css);

  // ---------- liste « Mes demi-journées »
  async function afficher() {
    if (ouverte) return ouvrirDj(ouverte, true);
    vue = 'liste'; arreter();
    z().innerHTML = '<h1>Émargement</h1><p class="muted">Chargement…</p>';
    try { data = await rpc('emg_mes_demi_journees'); } catch (e) { z().innerHTML = '<h1>Émargement</h1><div class="panel">Données indisponibles : ' + esc(msgErr(e)) + '</div>'; return; }
    majOnglet();
    if (!data.moi) { z().innerHTML = '<h1>Émargement</h1><div class="panel muted">L\'émargement est réservé aux formateurs de 2A Formation.</div>'; return; }
    const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    const ss = (data.sessions || []).filter(s => (s.demi_journees || []).some(d => d.jour >= auj || d.etat === 'ouverte'));
    const passees = (data.sessions || []).filter(s => !ss.includes(s));
    const bloc = s => '<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2>' + esc(s.intitule) + '</h2>' +
      '<div class="muted small">' + esc(s.code) + ' · ' + esc(s.lieu) + '</div></div>' +
      (s.fictive ? '<span class="chip">Session fictive</span>' : '') + (!s.publiee ? '<span class="chip soon">À valider</span>' : '') + '</div>' +
      (!s.publiee && data.moi.role === 'admin' ? '<div class="note" style="margin-top:10px">Session importée, pas encore visible d\'Antoine. Vérifiez la liste puis validez. <button class="primary" data-pub="' + s.id + '" style="margin-top:8px">Valider pour les formateurs</button></div>' : '') +
      '<div style="margin-top:8px">' + (s.demi_journees || []).map(d =>
        '<div class="emg-dj"><div><b>' + esc(jourCourt(d.jour)) + ' · ' + PERIODE[d.periode] + '</b> <span class="muted small">' + hfr(d.debut) + '–' + hfr(d.fin) + '</span><br>' +
        chip(d.etat) + ' <span class="muted small">' + d.signes + ' signé' + (d.signes > 1 ? 's' : '') + ' sur ' + d.attendus + (d.pdf ? ' · PDF prêt' : '') + (d.mienne ? '' : ' · pas votre demi-journée') + '</span></div>' +
        '<button class="' + (d.jour === auj && d.mienne && d.etat !== 'cloturee' && d.etat !== 'papier' ? 'primary' : '') + '" data-dj="' + d.id + '">' + (d.etat === 'ouverte' ? 'Reprendre' : d.jour === auj && d.etat === 'preparee' && d.mienne ? 'Ouvrir' : 'Voir') + '</button></div>').join('') + '</div>' +
      (data.moi.role === 'admin' ? '<div class="row" style="margin-top:10px"><button class="small" data-verif="' + s.id + '">Vérifier l\'intégrité</button></div>' : '') + '</div>';
    z().innerHTML = '<div class="row" style="justify-content:space-between;align-items:flex-end"><h1>Émargement</h1><button id="emgMaj" class="small">Actualiser</button></div>' +
      '<p class="muted">Vos demi-journées de formation : ouvrir, faire signer, clôturer.</p>' +
      '<div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">' + (ss.map(bloc).join('') || '<div class="panel muted">Aucune demi-journée à venir. Les sessions sont préparées par Claude à la demande d\'Alexandre, depuis le classeur des formations.</div>') + '</div>' +
      (passees.length ? '<details class="panel" style="margin-top:12px"><summary><b>Sessions passées</b> <span class="muted small">' + passees.length + '</span></summary><div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">' + passees.map(bloc).join('') + '</div></details>' : '');
    $('emgMaj').onclick = afficher;
    z().querySelectorAll('[data-dj]').forEach(b => b.onclick = () => ouvrirDj(b.dataset.dj));
    z().querySelectorAll('[data-pub]').forEach(b => b.onclick = () => action(b, async () => { await rpc('emg_publier', { p_session: b.dataset.pub, p_publiee: true }); toast('Session visible des formateurs'); afficher(); }));
    z().querySelectorAll('[data-verif]').forEach(b => b.onclick = () => action(b, async () => {
      const r = await rpc('emg_verifier', { p_session: b.dataset.verif });
      alerte(r.ok ? 'Intégrité vérifiée : ' + r.lignes + ' enregistrements, chaîne d\'empreintes intacte.' : 'ALERTE : ' + r.problemes.map(p => (p.table ? p.table + ' n°' + p.n + ' : ' : '') + p.probleme).join(' ; '));
    }));
  }
  function alerte(t) { const d = document.createElement('div'); d.className = 'emg-plein'; d.innerHTML = '<div class="in"><h2>Contrôle d\'intégrité</h2><div class="panel">' + esc(t) + '</div><button class="primary emg-big">Fermer</button></div>'; d.querySelector('button').onclick = () => d.remove(); document.body.appendChild(d); }

  // ---------- fiche d'une demi-journée
  async function ouvrirDj(id, silencieux) {
    ouverte = id; vue = 'dj'; arreter();
    if (!silencieux) z().innerHTML = '<p class="muted">Chargement…</p>';
    try { det = await rpc('emg_detail', { p_dj: id, p_images: false }); } catch (e) { toast(msgErr(e)); ouverte = null; return afficher(); }
    rendreDj();
    if (det.demi_journee.etat === 'ouverte') minuterie = setInterval(rafraichir, 4000);
  }
  async function rafraichir() {
    if (vue !== 'dj' || !ouverte || document.hidden) return;
    try { det = await rpc('emg_detail', { p_dj: ouverte, p_images: false }); rendreDj(true); } catch (e) {}
  }
  function retour() { ouverte = null; det = null; arreter(); fermerPlein(); afficher(); }

  function rendreDj(maj) {
    const s = det.session, d = det.demi_journee, st = det.stagiaires || [];
    const signes = st.filter(x => x.signe_le), manquants = st.filter(x => !x.signe_le);
    const mien = d.mienne;
    let corps = '';
    if (d.etat === 'preparee') {
      corps = '<div class="panel"><h3>Stagiaires attendus (' + st.length + ')</h3><ul class="list" style="margin-top:6px">' + st.map(x => '<li><div>' + esc(x.nom) + (x.ajoute_sur_place ? ' <span class="chip">ajouté sur place</span>' : '') + '</div></li>').join('') + '</ul></div>' +
        (mien ? '<div class="row">' + (d.aujourdhui ? '<button class="primary emg-big" id="eOuvrir" style="flex:1 1 100%">Ouvrir la demi-journée et afficher le QR</button>' : '<div class="note" style="flex:1 1 100%">L\'ouverture se fait le jour même (' + esc(jourLong(d.jour)) + ').</div>') +
        '<button id="eAjout">Ajouter un stagiaire sur place</button><button id="ePapier">Passer au papier</button></div>' : '');
    } else if (d.etat === 'ouverte') {
      corps = '<div class="panel emg-qr"><div class="emg-compteur num">' + signes.length + ' signé' + (signes.length > 1 ? 's' : '') + ' sur ' + st.length + '</div>' +
        (d.signature_fermee ? '<div class="note">La signature des stagiaires est fermée (30 min après l\'heure de fin). Clôturez maintenant.</div>' : '') +
        (mien ? '<button class="primary emg-big" id="eQR" style="width:100%">Afficher le QR en grand</button>' : '') + '</div>' +
        '<div class="panel"><h3>Pas encore signé (' + manquants.length + ')</h3><ul class="list" style="margin-top:6px">' + (manquants.map(x => '<li><div>' + esc(x.nom) + '</div>' + (mien && !d.signature_fermee ? '<button class="small" data-sec="' + x.id + '">Faire signer sur mon téléphone</button>' : '') + '</li>').join('') || '<li><div class="emg-ok">Tout le monde a signé.</div></li>') + '</ul></div>' +
        '<div class="panel"><h3>Ont signé (' + signes.length + ')</h3><ul class="list" style="margin-top:6px">' + signes.map(x => '<li><div>' + esc(x.nom) + '</div><span class="muted small">' + heure(x.signe_le) + (x.mode === 'appareil_formateur' ? ' · sur le téléphone du formateur' : '') + '</span></li>').join('') + '</ul></div>' +
        (mien ? '<div class="row"><button class="primary emg-big" id="eClore" style="flex:1 1 100%">Clôturer la demi-journée</button><button id="eAjout">Ajouter un stagiaire sur place</button><button id="ePapier">Passer au papier</button></div>' : '');
    } else {
      const c = det.cloture;
      corps = (d.etat === 'papier' ? '<div class="note">Demi-journée émargée sur papier' + (d.papier_le ? ' (depuis le ' + esc(quand(d.papier_le)) + ')' : '') + ' : la feuille papier fait foi. Rangez son scan dans 2_Emargements.</div>' : '') +
        (c ? '<div class="panel"><h3>Clôturée le ' + esc(quand(c.le)) + '</h3><p class="muted small">Référence de clôture : <span style="font-family:var(--f-data);word-break:break-all">' + esc(c.reference) + '</span></p>' +
          '<ul class="list" style="margin-top:6px">' + st.map(x => '<li><div>' + esc(x.nom) + '</div>' + (x.signe_le ? '<span class="emg-ok">' + heure(x.signe_le) + '</span>' : '<span class="emg-abs">ABSENT(E)</span>') + '</li>').join('') + '</ul>' +
          ((c.observations || []).length ? '<p style="margin-top:10px"><b>Observations :</b> ' + c.observations.map(o => esc(o.nom) + ' – ' + OBS[o.type] + (o.heure ? ' ' + esc(o.heure) : '')).join(' ; ') + '</p>' : '') + '</div>' : '') +
        '<div class="panel"><h3>PDF</h3>' + ((det.documents || []).length ? '<ul class="list">' + det.documents.map(o => '<li><div>' + (o.type === 'pdf_cloture' ? 'Feuille de la demi-journée' : 'Additif (annotation)') + '<br><span class="muted small">empreinte ' + esc(o.sha256.slice(0, 16)) + '…</span></div><button class="small" data-pdf="' + o.id + '">Ouvrir</button></li>').join('') + '</ul>' : '<p class="muted">' + (c ? 'PDF en préparation : il arrive aussi par mail.' : 'Pas de PDF pour une demi-journée sur papier.') + '</p>') + '</div>' +
        '<div class="panel"><h3>Annotations</h3>' + ((det.annotations || []).map(n => '<p class="small" style="margin-top:6px"><b>' + esc(quand(n.le)) + ' · ' + esc(n.auteur) + '</b> – ' + esc(n.texte) + '</p>').join('') || '<p class="muted small">Aucune.</p>') +
        '<p class="muted small" style="margin-top:8px">Une erreur après clôture se corrige par une annotation : elle s\'ajoute au dossier et produit un additif PDF, la feuille d\'origine ne change pas.</p>' +
        '<label class="f" style="margin-top:8px">Nouvelle annotation<textarea id="eAnnTxt" rows="2" maxlength="1000" placeholder="Ex. : erreur sur le prénom, absence justifiée après coup…"></textarea></label><div class="row" style="margin-top:8px"><button id="eAnn">Ajouter l\'annotation</button></div></div>';
    }
    z().innerHTML = '<div class="row"><button id="eRet" class="small">← Mes demi-journées</button></div>' +
      '<div><div class="eyebrow">' + esc(s.code) + (s.fictive ? ' · session fictive' : '') + '</div><h1 style="margin-top:4px">' + esc(jourLong(d.jour)) + ' · ' + PERIODE[d.periode] + '</h1>' +
      '<p class="muted">' + hfr(d.debut) + ' – ' + hfr(d.fin) + ' · ' + esc(s.intitule) + ' · ' + esc(s.lieu) + '</p><div style="margin-top:6px">' + chip(d.etat) + '</div></div>' + corps;
    $('eRet').onclick = retour;
    const on = (id, f) => { const b = $(id); if (b) b.onclick = () => f(b); };
    on('eOuvrir', b => action(b, async () => { const a = await rpc('emg_ouvrir', { p_dj: d.id }); memo('qr_' + d.id, a); toast('Demi-journée ouverte'); await ouvrirDj(d.id, true); pleinQR(); }));
    on('eQR', () => pleinQR());
    on('eAjout', () => formAjout());
    on('ePapier', b => {
      const motif = prompt('Passer au papier : la feuille papier fera foi pour cette demi-journée. Les signatures déjà faites restent enregistrées.\n\nMotif (ex. : pas de réseau) :', 'Pas de réseau');
      if (motif === null) return;
      action(b, async () => { await rpc('emg_papier', { p_dj: d.id, p_motif: motif }); toast('Demi-journée passée au papier'); await ouvrirDj(d.id, true); });
    });
    on('eClore', () => ecranCloture());
    on('eAnn', b => { const t = $('eAnnTxt').value.trim(); if (t.length < 3) { toast('Écrivez l\'annotation.'); return; }
      action(b, async () => { await rpc('emg_annoter', { p_dj: d.id, p_texte: t }); demanderPdf(d.id); toast('Annotation ajoutée'); await ouvrirDj(d.id, true); }); });
    z().querySelectorAll('[data-sec]').forEach(b => b.onclick = () => ecranSecours(st.find(x => x.id === b.dataset.sec)));
    z().querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => action(b, () => ouvrirPdf(b.dataset.pdf)));
    if (!maj) window.scrollTo(0, 0);
  }

  // ---------- QR plein écran (pour la salle)
  function chargerQR() {
    if (window.qrcode) return Promise.resolve();
    if (!qrPret) qrPret = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = QR_LIB; s.onload = ok; s.onerror = () => { qrPret = null; ko(new Error('QR indisponible (pas de réseau) : donnez l\'adresse et le code.')); }; document.head.appendChild(s); });
    return qrPret;
  }
  let plein = null;
  function fermerPlein() { if (plein) { plein.remove(); plein = null; } }
  async function pleinQR() {
    const d = det.demi_journee;
    let a = memo('qr_' + d.id);
    if (!a) { try { a = await rpc('emg_nouveau_code', { p_dj: d.id }); memo('qr_' + d.id, a); } catch (e) { toast(msgErr(e)); return; } }
    fermerPlein(); plein = document.createElement('div'); plein.className = 'emg-plein';
    plein.innerHTML = '<div class="in emg-qr"><div class="eyebrow">' + esc(det.session.intitule) + ' · ' + PERIODE[d.periode] + '</div>' +
      '<h2>Scannez pour signer</h2><div class="qr" id="eQRimg"><span class="muted">QR…</span></div>' +
      '<div class="muted">ou ouvrez <b>' + esc(lienCourt()) + '</b> et tapez le code</div><div class="emg-code">' + esc(a.code) + '</div>' +
      '<div class="emg-compteur num" id="eCpt"></div>' +
      '<div class="row" style="justify-content:center"><button class="primary emg-big" id="eFerme">Retour au suivi</button><button id="eNouv">Nouveau code</button></div>' +
      '<p class="muted small">Affichez ce QR seulement dans la salle. Chacun signe sur son propre téléphone.</p></div>';
    document.body.appendChild(plein);
    const cpt = () => { const st = det.stagiaires || []; const n = st.filter(x => x.signe_le).length; const e = plein && plein.querySelector('#eCpt'); if (e) e.textContent = n + ' signé' + (n > 1 ? 's' : '') + ' sur ' + st.length; };
    cpt(); const t = setInterval(() => { if (!plein) return clearInterval(t); cpt(); }, 1500);
    plein.querySelector('#eFerme').onclick = () => { fermerPlein(); rendreDj(); };
    plein.querySelector('#eNouv').onclick = e => action(e.target, async () => { const n = await rpc('emg_nouveau_code', { p_dj: d.id }); memo('qr_' + d.id, n); pleinQR(); });
    try {
      await chargerQR();
      const q = window.qrcode(0, 'M'); q.addData(lienSigner(a.jeton)); q.make();
      const box = plein && plein.querySelector('#eQRimg'); if (box) box.innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    } catch (e) { const box = plein && plein.querySelector('#eQRimg'); if (box) box.innerHTML = '<p>' + esc(e.message) + '</p>'; }
  }

  // ---------- zone de signature (image finale seulement)
  function pad(cont, change) {
    cont.innerHTML = '<canvas></canvas><div class="ind">Signez ici</div>';
    const cv = cont.querySelector('canvas'), ind = cont.querySelector('.ind'), W = 600, H = 200, ctx = cv.getContext('2d');
    let cur = null, lg = 0, x0 = 1e9, x1 = -1e9;
    cv.width = W; cv.height = H;
    const fond = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; };
    fond();
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} cur = pos(e); x0 = Math.min(x0, cur.x); x1 = Math.max(x1, cur.x); ind.hidden = true; ctx.beginPath(); ctx.moveTo(cur.x, cur.y); ctx.lineTo(cur.x + .1, cur.y); ctx.stroke(); });
    cv.addEventListener('pointermove', e => { if (!cur) return; e.preventDefault(); const p = pos(e); ctx.beginPath(); ctx.moveTo(cur.x, cur.y); ctx.lineTo(p.x, p.y); ctx.stroke(); lg += Math.hypot(p.x - cur.x, p.y - cur.y); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); cur = p; });
    const fin = () => { if (cur) { cur = null; change && change(); } };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cv.addEventListener(t, fin));
    return { valide: () => lg > 120 && x1 - x0 > 40, effacer: () => { fond(); lg = 0; x0 = 1e9; x1 = -1e9; ind.hidden = false; change && change(); }, image: () => cv.toDataURL('image/png').replace(/^data:image\/png;base64,/, '') };
  }

  // ---------- mode secours : le stagiaire signe sur le téléphone du formateur
  function ecranSecours(x) {
    if (!x) return; arreter(); fermerPlein();
    plein = document.createElement('div'); plein.className = 'emg-plein';
    plein.innerHTML = '<div class="in"><div class="eyebrow">Mode secours · téléphone du formateur</div><h2>' + esc(x.nom) + '</h2>' +
      '<p class="muted">Tendez le téléphone au stagiaire : il coche puis signe lui-même.</p>' +
      '<label class="row panel" style="align-items:flex-start;gap:12px;font-weight:700"><input type="checkbox" id="sOk" style="width:24px;height:24px"><span>Je suis ' + esc(x.nom) + ' et je suis présent(e) à cette demi-journée.</span></label>' +
      '<div class="emg-pad" id="sPad"></div><button id="sEff">Recommencer</button>' +
      '<button class="primary emg-big" id="sVal" disabled>Valider la signature</button><button id="sAnn">Annuler</button></div>';
    document.body.appendChild(plein);
    const ok = plein.querySelector('#sOk'), val = plein.querySelector('#sVal');
    const p = pad(plein.querySelector('#sPad'), () => { val.disabled = !(ok.checked && p.valide()); });
    ok.onchange = () => { val.disabled = !(ok.checked && p.valide()); };
    plein.querySelector('#sEff').onclick = () => p.effacer();
    plein.querySelector('#sAnn').onclick = () => { fermerPlein(); ouvrirDj(ouverte, true); };
    val.onclick = () => action(val, async () => {
      const r = await rpc('emg_signer_secours', { p_dj: det.demi_journee.id, p_stagiaire: x.id, p_image: p.image(), p_consentement: true });
      toast('Signature de ' + r.nom + ' enregistrée à ' + r.heure_paris); fermerPlein(); await ouvrirDj(ouverte, true);
    });
  }

  // ---------- ajout d'un stagiaire sur place
  function formAjout() {
    arreter(); fermerPlein();
    plein = document.createElement('div'); plein.className = 'emg-plein';
    plein.innerHTML = '<form class="in" id="aF"><h2>Ajouter un stagiaire sur place</h2><p class="muted">Il apparaîtra « ajouté sur place » sur la feuille. Prévenez Alexandre pour le reporter dans le classeur.</p>' +
      '<label class="f">Civilité<select id="aCiv"><option>Madame</option><option>Monsieur</option></select></label>' +
      '<label class="f">NOM<input id="aNom" required minlength="2" maxlength="80" autocapitalize="characters"></label>' +
      '<label class="f">Prénom<input id="aPre" required minlength="2" maxlength="80" autocapitalize="words"></label>' +
      '<button class="primary emg-big" type="submit">Ajouter</button><button type="button" id="aAnn">Annuler</button></form>';
    document.body.appendChild(plein);
    plein.querySelector('#aAnn').onclick = () => { fermerPlein(); ouvrirDj(ouverte, true); };
    plein.querySelector('#aF').onsubmit = e => { e.preventDefault(); const b = e.target.querySelector('[type=submit]');
      action(b, async () => { const r = await rpc('emg_ajouter_stagiaire', { p_dj: det.demi_journee.id, p_civilite: $('aCiv').value, p_nom: $('aNom').value, p_prenom: $('aPre').value }); toast(r.nom + ' ajouté(e)'); fermerPlein(); await ouvrirDj(ouverte, true); }); };
  }

  // ---------- clôture : récapitulatif, observations, signature des formateurs
  function ecranCloture() {
    arreter(); fermerPlein();
    const d = det.demi_journee, st = det.stagiaires || [], fs = det.formateurs || [], moi = data && data.moi ? data.moi.cle : '';
    plein = document.createElement('div'); plein.className = 'emg-plein';
    plein.innerHTML = '<div class="in"><div class="eyebrow">Clôture · ' + esc(jourLong(d.jour)) + ' · ' + PERIODE[d.periode] + '</div><h2>Vérifiez la feuille</h2>' +
      '<div class="panel"><ul class="list">' + st.map(x => '<li><div><b>' + esc(x.nom) + '</b><br>' + (x.signe_le ? '<span class="emg-ok">présent(e) · ' + heure(x.signe_le) + (x.mode === 'appareil_formateur' ? ' · téléphone du formateur' : '') + '</span>' : '<span class="emg-abs">ABSENT(E)</span>') + '</div>' +
        '<div class="emg-obs"><select data-o="' + x.id + '" aria-label="Observation pour ' + esc(x.nom) + '"><option value="">Pas d\'observation</option>' +
        (x.signe_le ? '<option value="arrivee">Arrivée à</option><option value="depart">Départ à</option>' : '<option value="absence_signalee">Absence signalée</option>') +
        '</select><input type="time" data-h="' + x.id + '" min="' + d.debut + '" max="' + d.fin + '" hidden aria-label="Heure"></div></li>').join('') + '</ul>' +
        '<p class="muted small" style="margin-top:8px">Pas de motif ni de détail de santé : seulement une heure ou « absence signalée ».</p></div>' +
      fs.map(f => '<div class="panel" data-f="' + esc(f.cle) + '"><label class="row" style="font-weight:700;gap:10px"><input type="checkbox" data-fp="' + esc(f.cle) + '"' + (f.cle === moi ? ' checked disabled' : '') + ' style="width:22px;height:22px"> ' + esc(f.nom) + (f.cle === moi ? ' (moi, obligatoire)' : ' était présent(e) et signe') + '</label>' +
        '<div class="emg-pad" data-pad="' + esc(f.cle) + '" style="margin-top:10px"' + (f.cle === moi ? '' : ' hidden') + '></div></div>').join('') +
      '<div class="note">Après la clôture, plus aucune signature ni modification : seulement des annotations. Le PDF part par mail.</div>' +
      '<button class="primary emg-big" id="cVal">Clôturer et signer</button><button id="cAnn">Annuler</button></div>';
    document.body.appendChild(plein);
    const pads = {};
    plein.querySelectorAll('[data-pad]').forEach(c => { pads[c.dataset.pad] = pad(c); });
    plein.querySelectorAll('[data-fp]').forEach(c => c.onchange = () => { plein.querySelector('[data-pad="' + c.dataset.fp + '"]').hidden = !c.checked; });
    plein.querySelectorAll('[data-o]').forEach(s => s.onchange = () => { const h = plein.querySelector('[data-h="' + s.dataset.o + '"]'); h.hidden = !(s.value === 'arrivee' || s.value === 'depart'); });
    plein.querySelector('#cAnn').onclick = () => { fermerPlein(); ouvrirDj(ouverte, true); };
    const val = plein.querySelector('#cVal');
    val.onclick = () => {
      const obs = [];
      for (const s of plein.querySelectorAll('[data-o]')) {
        if (!s.value) continue; const h = plein.querySelector('[data-h="' + s.dataset.o + '"]').value;
        if (s.value !== 'absence_signalee' && !/^\d{2}:\d{2}$/.test(h)) { toast('Indiquez l\'heure d\'arrivée ou de départ.'); return; }
        if (s.value !== 'absence_signalee' && (h <= d.debut || h >= d.fin)) { toast('L\'heure doit être comprise entre ' + hfr(d.debut) + ' et ' + hfr(d.fin) + '.'); return; }
        obs.push({ stagiaire_id: s.dataset.o, type: s.value, heure: s.value === 'absence_signalee' ? null : h });
      }
      const sigs = [];
      for (const c of plein.querySelectorAll('[data-fp]')) {
        if (!c.checked) continue; const p = pads[c.dataset.fp];
        if (!p.valide()) { toast('Signature manquante ou trop courte pour ' + (fs.find(f => f.cle === c.dataset.fp) || {}).nom); return; }
        sigs.push({ cle: c.dataset.fp, image: p.image() });
      }
      if (!confirm('Clôturer cette demi-journée ? Plus aucune signature ne sera possible.')) return;
      action(val, async () => {
        const r = await rpc('emg_cloturer', { p_dj: d.id, p_observations: obs, p_signatures: sigs });
        try { sessionStorage.removeItem('emg_qr_' + d.id); } catch (e) {}
        toast('Clôturée : ' + r.presents + ' présent(s), ' + r.absents + ' absent(s)'); fermerPlein();
        demanderPdf(d.id); await ouvrirDj(d.id, true);
      });
    };
  }

  // ---------- PDF (fonction serveur « emargement-pdf ») : production et lien de lecture
  function demanderPdf(dj) {
    sb.functions.invoke('emargement-pdf', { body: { action: 'produire', demi_journee_id: dj } }).then(r => {
      const t = $('eAnnTxt'); // ne pas effacer une annotation en cours de saisie
      if (r && !r.error && ouverte === dj && vue === 'dj' && !(t && t.value)) setTimeout(() => ouvrirDj(dj, true), 500);
    }).catch(() => {});
  }
  async function ouvrirPdf(docId) {
    const { data: r, error } = await sb.functions.invoke('emargement-pdf', { body: { action: 'lien', demi_journee_id: ouverte, document_id: docId } });
    if (error || !r || !r.url) throw new Error('PDF indisponible pour le moment.');
    window.open(r.url, '_blank', 'noopener');
  }

  // ---------- onglet visible seulement pour les formateurs
  async function majOnglet() {
    const a = document.querySelector('nav a[data-v="emargement"]'); if (!a) return;
    if (!data) { try { data = await rpc('emg_mes_demi_journees'); } catch (e) { return; } }
    a.hidden = !data.moi;
  }

  function init(o) { sb = o.sb; toast = o.toast; esc = o.esc; $ = o.$; majOnglet(); }
  return { init, afficher: () => sb && afficher(), quitter: () => { arreter(); fermerPlein(); }, majOnglet };
})();
