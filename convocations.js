// 2A Travail – convocations (lot A du cahier des charges « Convocations et évaluations à froid »).
// Sous-onglet « Convocations » de la fiche formation : Préparer → Aperçu et contrôle → Envoyer à l'établissement.
// Fichier séparé : n'utilise de app.js que sb, toast, esc et $, transmis par CNV.init(). Ne lit ni n'écrit aucune table :
// tout passe par les fonctions contrôlées public.env_* et les fonctions serveur convocations-pdf et envois-brevo.
// Aucun envoi sans le clic d'Alexandre ; la fonction serveur revérifie tout (compte, contrôles, case, empreintes).
'use strict';
const CNV = (() => {
  let sb, toast, esc, $;
  let zone = null, code = null, d = null, enCours = false;
  const ETATS = [['dossier_incomplet', 'Dossier incomplet'], ['pret_a_preparer', 'Prêt à préparer'], ['a_controler', 'À contrôler'], ['controle', 'Contrôlé'], ['envoye', 'Envoyé']];
  const NIV = { rouge: ['✗', 'var(--bad)'], orange: ['!', 'var(--warn)'], vert: ['✓', 'var(--ok)'] };
  const PIECE = { devis: 'Devis signé', fiche: 'Fiche pédagogique envoyée', programme: 'Programme' };
  const REMISE = { delivre: ['Délivré', 'ok'], rejete: ['Rejeté', 'late'], en_cours: ['En cours', 'soon'], inconnu: ['Pas encore connu', ''] };

  const css = document.createElement('style');
  css.textContent = `
  .cnv-etats{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 12px}
  .cnv-etats span{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--soft);opacity:.55}
  .cnv-etats span.on{opacity:1;background:#2E5B4E;color:#fff;font-weight:700}
  .cnv-ctl{display:grid;grid-template-columns:24px 1fr;gap:2px 8px;padding:7px 0;border-top:1px solid var(--line)}
  .cnv-ctl .p{width:20px;height:20px;border-radius:50%;color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
  .cnv-ctl .d{grid-column:2;font-size:13px;opacity:.8}
  .cnv-mail{white-space:pre-wrap;font-family:inherit;font-size:14px;background:var(--soft);border-radius:8px;padding:10px 12px;margin:6px 0}
  .cnv-kv{display:grid;grid-template-columns:110px 1fr;gap:2px 8px;font-size:14px}
  .cnv-kv b{font-weight:600;opacity:.75}
  .cnv-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line);font-size:14px}
  .cnv-li:first-child{border-top:0}
  `;
  document.head.appendChild(css);

  const msgErr = e => (e && (e.message || e.details)) || 'Action impossible pour le moment.';
  async function rpc(nom, args) { const { data, error } = await sb.rpc(nom, args || {}); if (error) throw error; return data; }
  async function fn(nom, body) {
    const { data, error } = await sb.functions.invoke(nom, { body });
    if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.erreur) m = j.erreur; } catch (x) {} throw new Error(m); }
    if (data && data.erreur) throw new Error(data.erreur);
    return data;
  }
  async function action(btn, f) { if (enCours) return; enCours = true; if (btn) btn.disabled = true; try { await f(); } catch (e) { toast(msgErr(e)); } finally { enCours = false; if (btn) btn.disabled = false; } }
  const ko = n => (n / 1024 < 1000 ? Math.round(n / 1024) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo');
  const lire = file => new Promise((ok, ko2) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ko2(new Error('Lecture du fichier impossible.')); r.readAsDataURL(file); });

  async function afficher() {
    if (!zone) return;
    try { d = await rpc('env_etat', { p_code: code }); } catch (e) { zone.innerHTML = '<div class="panel muted">' + esc(msgErr(e)) + '</div>'; return; }
    rendre();
  }

  function blocPreparer() {
    const k = d.dossier && d.dossier.contenu, P = {}; (d.pieces || []).forEach(p => P[p.type] = p);
    const DEP = {}; (d.depots || []).forEach(p => DEP[p.type] = p);
    const admin = d.moi.role === 'admin';
    const ligne = (ok, txt, extra) => '<div class="cnv-li"><span>' + (ok ? '✓' : '✗') + ' ' + txt + '</span>' + (extra || '') + '</div>';
    let h = '<div class="panel"><h3 style="margin-top:0">1. Préparer</h3>';
    if (!k) h += '<p class="muted">Claude n’a pas encore importé le dossier de convocation (devis signé, fiche réellement envoyée, programme, interlocuteur, stagiaires). Demandez-lui : « Prépare le dossier de convocation de la session ' + esc(code) + ' ».</p>';
    else {
      h += '<p class="muted small" style="margin-top:0">Dossier relevé par Claude, version ' + d.dossier.version + ' du ' + esc(d.dossier.importe_le) + '.</p>';
      ['devis', 'fiche', 'programme'].forEach(t => {
        const x = k[t] || {};
        const info = t === 'devis' ? 'n° ' + (x.numero || '–') + (x.signe ? ', signé le ' + (x.signe_le || '–') : ', NON SIGNÉ')
          : t === 'fiche' ? 'jointe au mail du ' + (x.mail_le || '–') : (x.objectifs || []).length + ' objectif(s)';
        const etat = P[t] ? '<a href="#" data-lire="' + esc(P[t].id) + '" class="small">Ouvrir</a>'
          : DEP[t] ? '<span class="chip soon">déposé, rangé à la préparation</span>'
          : '<label class="small" style="cursor:pointer"><input type="file" accept="application/pdf,.pdf" data-depot="' + t + '" hidden><span class="chip late">Déposer le PDF</span></label>';
        h += ligne(!!P[t] || !!DEP[t], '<b>' + PIECE[t] + '</b> – ' + esc(info) + (P[t] || DEP[t] ? '' : '<div class="muted small">Fichier attendu : ' + esc(x.nom || '–') + '</div>'), etat);
      });
      const i = k.interlocuteur || {};
      h += ligne(!!(i.civ_nom && i.email), '<b>Interlocuteur</b> – ' + esc([i.civ_nom, i.fonction].filter(Boolean).join(', ') || '–') + ' · ' + esc(i.email || 'adresse absente'));
      h += ligne(((k.classeur || {}).stagiaires || []).length > 0, '<b>Stagiaires</b> – ' + ((k.classeur || {}).stagiaires || []).length + ' dans le classeur');
    }
    const rg = d.reglement, rgDep = DEP.reglement;
    h += ligne(!!rg || !!rgDep, '<b>Règlement intérieur</b> – ' + (rg ? 'version du ' + esc(rg.version_du) : rgDep ? 'déposé, enregistré à la préparation' : 'aucun enregistré'),
      !rg && !rgDep && admin ? '<span class="row" style="gap:6px"><input type="date" id="cRgDu" style="max-width:150px"><label class="small" style="cursor:pointer"><input type="file" accept="application/pdf,.pdf" data-depot="reglement" hidden><span class="chip late">Déposer</span></label></span>' : '');
    const p = d.preparation;
    h += '<div class="row" style="margin-top:10px">' + (k ? '<button class="primary" id="cPrep"' + (d.etat === 'dossier_incomplet' ? ' disabled' : '') + '>' +
      (p ? 'Préparer une nouvelle version' : 'Préparer les documents') + '</button>' : '') +
      (p ? '<span class="muted small">Version ' + p.version + ' préparée le ' + esc(p.le) + ' par ' + esc(p.par) + (p.a_jour ? '' : ' – <b>plus à jour</b> : préparer de nouveau') + '</span>' : '') + '</div>';
    return h + '</div>';
  }

  function blocControle() {
    const p = d.preparation; if (!p) return '';
    const a = d.apercu || {}, R = d.rouges, O = (d.oranges || []).length;
    let h = '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">2. Aperçu et contrôle</h3>';
    h += '<div><b>Contrôles automatiques</b> <span class="muted small">(' + (R ? R + ' rouge(s) : envoi bloqué, corriger la source puis préparer de nouveau' : O ? O + ' point(s) orange à vérifier' : 'tout est vert') + ')</span></div>';
    h += (d.controles || []).map(c => '<div class="cnv-ctl"><span class="p" style="background:' + NIV[c.niveau][1] + '">' + NIV[c.niveau][0] + '</span><b>' + esc(c.libelle) + '</b><span class="d">' + esc(c.detail) + '</span></div>').join('');
    h += '<details style="margin-top:10px"><summary><b>Documents préparés</b> (' + p.documents.length + ' convocation(s))</summary>' +
      p.documents.map(x => '<div class="cnv-li"><span>' + esc(x.nom) + ' <span class="muted small">' + ko(x.octets) + '</span></span><a href="#" data-lire="' + esc(x.id) + '" class="small">Ouvrir</a></div>').join('') +
      (d.pieces || []).map(x => '<div class="cnv-li"><span>' + esc(PIECE[x.type]) + ' – ' + esc(x.nom) + '</span><a href="#" data-lire="' + esc(x.id) + '" class="small">Ouvrir</a></div>').join('') + '</details>';
    h += '<details style="margin-top:8px" open><summary><b>Aperçu exact du mail</b></summary><div class="cnv-kv" style="margin-top:8px"><b>De</b><span>2A Formation &lt;' + esc(a.expediteur || '') + '&gt;</span><b>Réponse à</b><span>' + esc(a.reponse || '') +
      '</span><b>À</b><span>' + esc(a.destinataire || '–') + '</span><b>Copie cachée</b><span>' + esc(a.cci || '–') + '</span><b>Objet</b><span>' + esc(a.objet || '') +
      '</span><b>Pièces jointes</b><span>' + p.documents.length + ' convocation(s), programme, règlement intérieur</span></div><div class="cnv-mail">' + esc(a.texte || '') + '</div></details>';
    if (d.visa) h += '<p class="small" style="margin-top:10px">✓ <b>Documents contrôlés par ' + esc(d.visa.par) + '</b> (case cochée par ' + esc(d.visa.coche_par) + ' le ' + esc(d.visa.le) + ').</p>';
    else if (d.etat !== 'envoye') h += '<div class="note" style="margin-top:10px"><b>Documents contrôlés par :</b> <label><input type="radio" name="cPar" value="Antoine"> Antoine</label> <label><input type="radio" name="cPar" value="Alexandre"> Alexandre</label>' +
      (O ? '<div style="margin-top:6px"><label><input type="checkbox" id="cOr"> J’ai vérifié les ' + O + ' point(s) orange</label></div>' : '') +
      '<div class="row" style="margin-top:8px"><button id="cVis"' + (R ? ' disabled' : '') + '>Enregistrer le contrôle</button>' + (R ? '<span class="muted small">Impossible tant qu’un contrôle est rouge.</span>' : '') + '</div></div>';
    h += '<div class="row" style="margin-top:10px"><button id="cTest">M’envoyer un test</button><span class="muted small">Le même mail, marqué [TEST], envoyé seulement à 2aa.formation@gmail.com.</span></div>';
    return h + '</div>';
  }

  function blocEnvoyer() {
    const p = d.preparation; if (!p) return '';
    const reels = (d.envois || []).filter(e => e.type !== 'test');
    const dejaPrep = reels.some(e => e.preparation === p.version);
    let h = '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">3. Envoyer à l’établissement</h3>';
    if (d.moi.role !== 'admin') h += '<p class="muted small">L’envoi est fait par Alexandre depuis son compte.</p>';
    else if (!dejaPrep) {
      const ok = d.etat === 'controle' && !d.rouges;
      h += (reels.length ? '<label class="f">Motif de la version corrigée (obligatoire)<input id="cMotif" placeholder="ex. un participant remplacé"></label>' : '') +
        '<div class="row"><button class="primary" id="cEnv"' + (ok ? '' : ' disabled') + '>' + (reels.length ? 'Envoyer une version corrigée' : 'Envoyer à l’établissement') + '</button>' +
        (ok ? '' : '<span class="muted small">' + (d.rouges ? 'Bloqué : contrôle rouge.' : 'Cochez d’abord « Documents contrôlés par ».') + '</span>') + '</div><div id="cConf" hidden></div>';
    }
    if ((d.envois || []).length) h += '<div style="margin-top:10px">' + d.envois.map(e => {
      const r = e.remise ? REMISE[e.remise.statut] : null;
      return '<div class="cnv-li" style="align-items:flex-start"><div><b>' + (e.type === 'test' ? 'Test' : e.type === 'corrige' ? 'Version corrigée' : 'Envoi') + '</b> le ' + esc(e.le) + ' · version ' + e.preparation +
        '<div class="small">À ' + esc(e.destinataire) + (e.cci ? ' · cci ' + esc(e.cci) : '') + ' · par ' + esc(e.auteur) + (e.controle_par ? ' · contrôlé par ' + esc(e.controle_par) : '') + '</div>' +
        (e.motif ? '<div class="small">Motif : ' + esc(e.motif) + '</div>' : '') +
        '<div class="muted small">' + e.pieces.length + ' pièce(s) · Brevo ' + esc(e.brevo_id || '–') + (r ? ' · remise : <span class="chip ' + r[1] + '">' + r[0] + '</span> (' + esc(e.remise.le) + ')' : '') + '</div></div>' +
        '<div class="row" style="gap:6px;flex-wrap:nowrap">' + (e.brevo_id ? '<button class="small" data-remise="' + esc(e.id) + '">Vérifier la remise</button>' : '') +
        (e.preuve ? '<button class="small" data-lire="' + esc(e.preuve) + '">Preuve d’envoi</button>' : '') + '</div></div>';
    }).join('') + '</div>';
    return h + '</div>';
  }

  function rendre() {
    if (!d || !d.session) { zone.innerHTML = '<div class="panel muted">La session ' + esc(code) + ' n’existe pas encore dans l’émargement : Claude importe d’abord l’émargement, puis le dossier de convocation.</div>'; return; }
    const i = ETATS.findIndex(x => x[0] === d.etat);
    zone.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center"><p class="muted" style="margin:0">Convocations, programme et règlement intérieur, envoyés à l’interlocuteur de l’établissement. Le papier reste possible.</p><button id="cMaj" class="small">Actualiser</button></div>' +
      (d.session.fictive ? '<p style="margin-top:8px"><span class="chip">Session fictive</span> <span class="muted small">envoi permis seulement vers une adresse de 2A Formation</span></p>' : '') +
      '<div class="cnv-etats">' + ETATS.map((x, k) => '<span class="' + (k === i ? 'on' : '') + '">' + (k < i ? '✓ ' : '') + x[1] + (x[0] === 'envoye' && k === i ? ' le ' + esc((d.envois.find(e => e.type !== 'test') || {}).le || '') : '') + '</span>').join('') + '</div>' +
      blocPreparer() + blocControle() + blocEnvoyer() +
      '<div class="row" style="margin-top:12px"><button class="small" id="cInt">Vérifier l’intégrité</button></div><div id="cIntRes" hidden style="margin-top:8px"></div>';
    const on = (id, f) => { const b = $(id); if (b) b.onclick = () => f(b); };
    on('cMaj', () => afficher());
    on('cPrep', b => action(b, async () => { toast('Préparation des documents…'); const r = await fn('convocations-pdf', { action: 'preparer', session_id: d.session.id }); toast('Version ' + r.version + ' : ' + r.convocations + ' convocation(s) préparée(s)'); await afficher(); }));
    on('cVis', b => {
      const par = (zone.querySelector('input[name=cPar]:checked') || {}).value;
      if (!par) { toast('Choisissez Antoine ou Alexandre.'); return; }
      const or = $('cOr'); if (or && !or.checked) { toast('Cochez « J’ai vérifié les points orange ».'); return; }
      action(b, async () => { await rpc('env_viser', { p_preparation: d.preparation.id, p_par: par }); toast('Contrôle enregistré'); await afficher(); });
    });
    on('cTest', b => action(b, async () => { await fn('envois-brevo', { action: 'test', session_id: d.session.id, preparation_id: d.preparation.id }); toast('Test envoyé à 2aa.formation@gmail.com'); await afficher(); }));
    on('cEnv', b => {
      const motif = $('cMotif') ? $('cMotif').value.trim() : '';
      if ($('cMotif') && motif.length < 5) { toast('Indiquez le motif de la version corrigée.'); return; }
      // confirmation dans la page (pas de fenêtre du navigateur, parfois bloquée)
      const n = d.preparation.documents.length + 2, box = $('cConf');
      box.hidden = false;
      box.innerHTML = '<div class="note" style="margin-top:10px"><b>Envoyer maintenant à ' + esc((d.apercu || {}).destinataire) + ' ?</b><div class="small" style="margin-top:4px">' + n + ' pièces jointes (' +
        d.preparation.documents.length + ' convocation(s), programme, règlement intérieur). Copie cachée : 2aa.formation@gmail.com.' + (motif ? ' Motif : ' + esc(motif) : '') +
        '</div><div class="row" style="margin-top:8px"><button class="primary" id="cOui">Confirmer l’envoi</button><button id="cNon">Annuler</button></div></div>';
      $('cNon').onclick = () => { box.hidden = true; box.innerHTML = ''; };
      $('cOui').onclick = () => action($('cOui'), async () => { const r = await fn('envois-brevo', { action: 'envoyer', session_id: d.session.id, preparation_id: d.preparation.id, motif: motif || null }); toast('Envoyé' + (r.preuve ? ' ; preuve d’envoi au Gmail' : '')); await afficher(); });
    });
    on('cInt', b => action(b, async () => { const r = await rpc('env_verifier', { p_session: d.session.id }); const o = $('cIntRes'); o.hidden = false; o.className = 'note small'; o.textContent = r.ok ? 'Intégrité vérifiée : ' + r.lignes + ' enregistrement(s), chaîne d’empreintes intacte.' : 'ALERTE : ' + r.problemes.map(x => (x.table ? x.table + ' n°' + x.n + ' : ' : '') + x.probleme).join(' ; '); }));
    zone.querySelectorAll('[data-lire]').forEach(a => a.onclick = ev => { ev.preventDefault(); action(null, async () => { const r = await fn('convocations-pdf', { action: 'lien', session_id: d.session.id, fichier: a.dataset.lire }); window.open(r.url, '_blank', 'noopener'); }); });
    zone.querySelectorAll('[data-remise]').forEach(b => b.onclick = () => action(b, async () => { const r = await fn('envois-brevo', { action: 'remise', session_id: d.session.id, envoi_id: b.dataset.remise }); toast('Remise : ' + REMISE[r.statut][0]); await afficher(); }));
    zone.querySelectorAll('[data-depot]').forEach(inp => inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const type = inp.dataset.depot, du = $('cRgDu') ? $('cRgDu').value : '';
      if (type === 'reglement' && !du) { toast('Indiquez la date de version du règlement.'); inp.value = ''; return; }
      if (f.size > 4000000) { toast('PDF trop lourd (4 Mo au plus).'); inp.value = ''; return; }
      action(null, async () => { const b64 = await lire(f); await fn('convocations-pdf', { action: 'deposer', session_id: d.session.id, type, nom: f.name, contenu: b64, reglement_du: du || null }); toast('PDF déposé'); await afficher(); });
    });
  }

  function monter(el, c) { if (!sb || !el) return; if (code !== c) d = null; zone = el; code = c; zone.innerHTML = '<div class="panel muted">Chargement…</div>'; afficher(); }
  function init(o) { sb = o.sb; toast = o.toast; esc = o.esc; $ = o.$; }
  return { init, monter, quitter: () => { zone = null; } };
})();
