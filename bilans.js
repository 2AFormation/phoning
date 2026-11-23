// 2A Travail – bilans de formation (positionnement, appréciation des acquis, évaluation à chaud,
// auto-évaluation des formateurs, PDF de résultats, évaluations à froid). Sous-onglet « Bilans » de la fiche formation.
// v22 : étape « À froid » (lot B) ; confirmations dans la page (window.confirm et alert sont bloqués dans le navigateur intégré).
// Fichier séparé : n'utilise de app.js que sb, toast, esc et $, transmis par BIL.init(). Ne lit ni n'écrit
// aucune table : tout passe par les fonctions contrôlées public.bil_* (schéma « bilans » verrouillé).
// Les questionnaires s'affichent avec questionnaire.js (QUEST), le même que la page des stagiaires.
'use strict';
const BIL = (() => {
  const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const ETAT = { preparee: ['À ouvrir', ''], ouverte: ['Ouvert', 'soon'], fermee: ['Fermé', 'ok'] };
  const NIV = [['acquis', 'Acquis'], ['en_cours', 'En cours'], ['a_renforcer', 'À renforcer']];
  const NOM_TYPE = { positionnement: 'Positionnement', chaud: 'Évaluation à chaud', froid_stagiaire: 'À froid · stagiaires', froid_responsable: 'À froid · établissement' };
  let sb, toast, esc, $;
  let zone = null, code = null, d = null, enCours = false, plein = null, minuterie = null, qrPret = null;

  // ---------- outils
  const msgErr = e => (e && (e.message || e.details)) || 'Action impossible pour le moment.';
  async function rpc(nom, args) { const { data, error } = await sb.rpc(nom, args || {}); if (error) throw error; return data; }
  async function action(btn, fn) { if (enCours) return; enCours = true; if (btn) btn.disabled = true; try { await fn(); } catch (e) { toast(msgErr(e)); } finally { enCours = false; if (btn) btn.disabled = false; } }
  // Fonction serveur : le message d'erreur renvoyé par la fonction est affiché tel quel
  async function fn(nom, body) {
    const { data, error } = await sb.functions.invoke(nom, { body });
    if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.erreur) m = j.erreur; } catch (x) { /* message générique */ } throw new Error(m); }
    if (data && data.erreur) throw new Error(data.erreur);
    return data;
  }
  // Confirmation et message dans la page (html déjà échappé par l'appelant)
  function confirmer(html, oui, non) {
    return new Promise(ok => {
      const c = document.createElement('div'); c.className = 'bil-conf';
      c.innerHTML = '<div class="in"><div>' + html + '</div><div class="row" style="margin-top:12px;justify-content:flex-end">' +
        (non === null ? '' : '<button data-r="0">' + esc(non || 'Annuler') + '</button>') + '<button class="primary" data-r="1">' + esc(oui || 'Confirmer') + '</button></div></div>';
      document.body.appendChild(c);
      c.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { c.remove(); ok(b.dataset.r === '1'); });
    });
  }
  const informer = html => confirmer(html, 'OK', null);
  const frDate = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
  const plusJours = (iso, n) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const camp = t => (d.campagnes || []).find(c => c.type === t);
  const reps = c => (d.reponses || []).filter(r => c && r.campagne === c.id);
  const memo = (k, v) => { try { if (v === undefined) return JSON.parse(sessionStorage.getItem('bil_' + k) || 'null'); sessionStorage.setItem('bil_' + k, JSON.stringify(v)); } catch (e) { return null; } };
  const lienRepondre = j => new URL('bilan.html#t=' + j, location.href).href;
  const lienCourt = () => new URL('b', location.href).href.replace(/^https?:\/\//, '');
  const chip = e => '<span class="chip ' + ETAT[e][1] + '">' + ETAT[e][0] + '</span>';
  const moy = l => l.length ? l.reduce((a, b) => a + b, 0) / l.length : null;
  const nf = x => x == null ? '–' : (Math.round(x * 10) / 10).toString().replace('.', ',');
  function arreter() { clearInterval(minuterie); minuterie = null; }
  function fermerPlein() { if (plein) { plein.remove(); plein = null; } arreter(); }
  function ouvrirPlein(html) { fermerPlein(); plein = document.createElement('div'); plein.className = 'bil-plein'; plein.innerHTML = '<div class="in">' + html + '</div>'; document.body.appendChild(plein); return plein; }

  const css = document.createElement('style');
  css.textContent = `
  .bil-etape{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line)}
  .bil-etape:last-child{border-bottom:0}
  .bil-num{flex:0 0 30px;height:30px;border-radius:50%;background:var(--line);display:flex;align-items:center;justify-content:center;font-weight:800}
  .bil-etape.fait .bil-num{background:var(--ok);color:#fff}
  .bil-etape.maintenant .bil-num{background:#B8572A;color:#fff}
  .bil-corps{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}
  .bil-corps .row{gap:8px}
  .bil-plein{position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto;padding:calc(14px + env(safe-area-inset-top,0px)) 16px calc(20px + env(safe-area-inset-bottom,0px))}
  .bil-plein .in{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  .bil-qr{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
  .bil-qr .qr{background:#fff;padding:14px;border-radius:14px;width:min(78vw,420px);aspect-ratio:1;display:flex;align-items:center;justify-content:center}
  .bil-qr .qr svg{width:100%;height:100%}
  .bil-code{font-family:var(--f-data);font-size:clamp(34px,9vw,56px);letter-spacing:.18em;font-weight:500}
  .bil-cpt{font-family:var(--f-display);font-weight:800;font-size:clamp(28px,7vw,42px)}
  .bil-big{min-height:54px;font-size:17px;justify-content:center}
  .bil-niv{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .bil-niv button{min-height:42px;font-size:14px;padding:4px}
  .bil-niv button[aria-pressed=true]{background:#2E5B4E;color:#fff;border-color:#2E5B4E;font-weight:700}
  .bil-niv button[aria-pressed=true].ar{background:#A8323C;border-color:#A8323C}
  .bil-niv button[aria-pressed=true].ec{background:#B8572A;border-color:#B8572A}
  .bil-crit{padding:8px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
  .bil-barre{height:10px;background:var(--line);border-radius:6px;overflow:hidden;flex:1}
  .bil-barre div{height:100%;background:#2E5B4E}
  .bil-res{display:flex;align-items:center;gap:10px;font-size:14px}
  .bil-res .l{flex:0 0 46%}
  .bil-res .v{flex:0 0 42px;text-align:right;font-family:var(--f-data)}
  .bil-txt{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;white-space:pre-wrap}
  .bil-conf{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .bil-conf .in{background:var(--bg);border-radius:14px;padding:16px;max-width:460px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.25)}
  .bil-ctl{display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:14px}
  .bil-ctl>span{flex:0 0 16px;font-weight:800;text-align:center}
  .bil-ctl .r{color:var(--bad)}.bil-ctl .o{color:var(--warn)}.bil-ctl .v{color:var(--ok)}
  `;
  document.head.appendChild(css);

  // ---------- chargement et étapes
  // L'état de l'à froid (bil_froid_etat) est relu avec la session, sauf pendant l'affichage du QR (relecture toutes les 4 s)
  async function charger(froid = true) {
    const ancien = d && d.froid;
    d = await rpc('bil_session', { p_code: code });
    if (d && d.session) {
      if (froid) { try { d.froid = await rpc('bil_froid_etat', { p_session: d.session.id }); } catch (e) { d.froid = null; } }
      else d.froid = ancien;
    }
    return d;
  }
  async function afficher(silencieux) {
    if (!zone) return;
    if (!silencieux) zone.innerHTML = '<p class="muted">Chargement…</p>';
    try { await charger(); } catch (e) { zone.innerHTML = '<div class="panel">Bilans indisponibles : ' + esc(msgErr(e)) + '</div>'; return; }
    if (!d.moi) { zone.innerHTML = '<div class="panel muted">Les bilans sont réservés aux formateurs de 2A Formation.</div>'; return; }
    if (!d.session) {
      zone.innerHTML = '<div class="panel muted">' + (d.pas_encore ? 'Les bilans de cette formation sont prêts mais pas encore validés par Alexandre.'
        : 'Les bilans de cette formation (' + esc(code) + ') ne sont pas encore préparés : Claude les prépare à la demande d’Alexandre, avec les objectifs du programme envoyé et les critères de la grille des acquis, puis Alexandre les valide.') + '</div>';
      return;
    }
    rendre();
  }

  function etapes() {
    const s = d.session, auj = s.aujourdhui, moi = d.moi, P = camp('positionnement'), C = camp('chaud');
    const N = (d.stagiaires || []).length, nc = (s.criteres || []).length, rempli = (d.acquis || []).length;
    const autos = d.autoevaluations || [], monAuto = autos.some(a => a.formateur === moi.cle), jeSuisFormateur = (s.formateurs || []).includes(moi.cle);
    const E = [];
    // 1. positionnement
    if (P) E.push({ k: 'pos', titre: 'Positionnement des stagiaires', fait: P.etat === 'fermee' || P.nb >= N,
      quand: 'Début du ' + (s.premier_jour === auj ? 'jour 1 (aujourd’hui)' : 'jour 1, le ' + frDate(s.premier_jour)),
      txt: P.nb + ' réponse' + (P.nb > 1 ? 's' : '') + ' sur ' + N + (P.nb_papier ? ' (dont ' + P.nb_papier + ' saisie' + (P.nb_papier > 1 ? 's' : '') + ' du papier)' : '') + ' · ' + chip(P.etat),
      aide: P.etat === 'preparee' ? 'Montrez le QR code au début de la première matinée ; chacun répond sur son téléphone (5 minutes). Un questionnaire rempli sur papier se saisit ici.' : P.etat === 'ouverte' ? 'Lisez la synthèse avant de commencer, puis fermez le questionnaire.' : '',
      boutons: (P.etat === 'preparee' ? '<button class="primary" data-ouvrir="' + P.id + '">Ouvrir et afficher le QR</button>' : '') +
        (P.etat === 'ouverte' ? '<button class="primary" data-qr="' + P.id + '">Afficher le QR</button><button data-fermer="' + P.id + '">Fermer</button>' : '') +
        '<button data-papier="' + P.id + '">Saisir un questionnaire papier</button>' + (P.nb ? '<button data-voir="' + P.id + '">Lire les réponses</button>' : '') });
    // 2. grille des acquis
    E.push({ k: 'acq', titre: 'Appréciation des acquis', fait: !!d.validation, quand: 'Pendant la session, validée le dernier jour',
      txt: d.validation ? 'Validée le ' + esc(d.validation.le) + ' par ' + esc(nomF(d.validation.par)) : rempli + ' case' + (rempli > 1 ? 's' : '') + ' remplie' + (rempli > 1 ? 's' : '') + ' sur ' + N * nc + ' (' + N + ' stagiaires × ' + nc + ' critères)',
      aide: d.validation ? '' : 'Pour chaque stagiaire et chaque critère : Acquis, En cours ou À renforcer. Les deux formateurs peuvent remplir ; on valide une fois à la fin.',
      boutons: '<button class="' + (d.validation ? '' : 'primary') + '" data-grille="1">' + (d.validation ? 'Voir la grille' : 'Remplir la grille') + '</button>' });
    // 3. évaluation à chaud
    if (C) E.push({ k: 'chaud', titre: 'Évaluation à chaud', fait: C.etat === 'fermee',
      quand: 'Fin du dernier jour' + (s.dernier_jour === auj ? ' (aujourd’hui)' : ', le ' + frDate(s.dernier_jour)) + ', avant la clôture de l’émargement',
      txt: C.nb + ' réponse' + (C.nb > 1 ? 's' : '') + ' sur ' + N + (C.nb_papier ? ' (dont ' + C.nb_papier + ' du papier)' : '') + ' · ' + chip(C.etat) + (d.contacts_froid ? ' · ' + d.contacts_froid + ' adresse' + (d.contacts_froid > 1 ? 's' : '') + ' pour le questionnaire à froid' : ''),
      aide: C.etat === 'preparee' ? 'Questionnaire anonyme (nom facultatif). La feuille papier reste dans le dossier, au cas où.' : C.etat === 'ouverte' ? 'Les résultats s’affichent une fois le questionnaire fermé.' : '',
      boutons: (C.etat === 'preparee' ? '<button class="primary" data-ouvrir="' + C.id + '">Ouvrir et afficher le QR</button>' : '') +
        (C.etat === 'ouverte' ? '<button class="primary" data-qr="' + C.id + '">Afficher le QR</button><button data-fermer="' + C.id + '">Fermer</button>' : '') +
        '<button data-papier="' + C.id + '">Saisir un questionnaire papier</button>' + (C.etat === 'fermee' && C.nb ? '<button data-voir="' + C.id + '">Voir les résultats</button>' : '') });
    // 4. auto-évaluation
    E.push({ k: 'auto', titre: 'Auto-évaluation des formateurs', fait: (s.formateurs || []).every(f => autos.some(a => a.formateur === f)), quand: 'Dans les 8 jours',
      txt: (d.formateurs || []).map(f => esc(f.nom) + ' : ' + (autos.some(a => a.formateur === f.cle) ? '<span class="emg-ok">faite</span>' : 'à faire')).join(' · '),
      aide: '', boutons: (jeSuisFormateur && !monAuto ? '<button class="primary" data-auto="1">Remplir mon auto-évaluation</button>' : '') + (autos.length ? '<button data-voirauto="1">Lire</button>' : '') });
    // 5. fiche synthèse
    E.push({ k: 'fs', titre: 'Fiche synthèse au client', fait: false, quand: 'Sous 8 jours (avant le ' + frDate(plusJours(s.dernier_jour, 8)) + ')',
      txt: 'Document Word rangé dans 5_Fiches_synthèses ; à cocher dans l’onglet Étapes.', aide: '', boutons: '' });
    // 6. PDF de résultats
    const docs = d.documents || [];
    E.push({ k: 'pdf', titre: 'Bilan PDF de la session', fait: docs.length > 0, quand: 'Après l’évaluation à chaud, la grille et les auto-évaluations',
      txt: docs.length ? docs.map(o => 'Version ' + o.version + ' du ' + esc(o.le)).join(' · ') : 'Pas encore produit.',
      aide: C && C.etat === 'fermee' ? 'Le PDF part par mail à 2aa.formation et aux formateurs ; Claude le range dans 7_Evaluations.' : 'Disponible une fois l’évaluation à chaud fermée.',
      boutons: (C && C.etat === 'fermee' ? '<button class="' + (docs.length ? '' : 'primary') + '" data-pdf="1">' + (docs.length ? 'Produire une nouvelle version' : 'Produire le PDF') + '</button>' : '') +
        docs.map(o => '<button data-lire="' + o.id + '">Ouvrir la version ' + o.version + '</button>').join('') });
    // 7. à froid (lot B) : préparation, adresses, envoi par Alexandre, remise, clôture, bilan à froid
    const F = d.froid, FS = camp('froid_stagiaire'), FR = camp('froid_responsable'), fdocs = (F && F.documents) || [], admin = moi.role === 'admin';
    const fEnv = F && F.envoi && F.envoi.envoye_le, fFerme = FS && FR && FS.etat === 'fermee' && FR.etat === 'fermee';
    E.push({ k: 'froid', titre: 'Évaluations à froid (stagiaires et établissement)', fait: fdocs.length > 0,
      quand: 'À partir du ' + frDate(F ? F.j90 : plusJours(s.dernier_jour, 90)) + ' (3 mois après)' + (F && F.date_limite ? ', réponses jusqu’au ' + frDate(F.date_limite) : ''),
      txt: !F ? 'État indisponible pour le moment.' : [
        F.preparee ? null : 'Pas encore préparées',
        F.adresses + ' adresse' + (F.adresses > 1 ? 's' : '') + ' en attente d’envoi',
        fEnv ? 'envoyé le ' + esc(F.envoi.envoye_le) : F.preparee ? 'pas encore envoyé' : null,
        FS ? 'stagiaires : ' + FS.nb + ' réponse' + (FS.nb > 1 ? 's' : '') + ' ' + chip(FS.etat) : null,
        FR ? 'établissement : ' + FR.nb + ' ' + chip(FR.etat) : null,
        fdocs.length ? 'bilan à froid : version ' + fdocs[fdocs.length - 1].version : null].filter(Boolean).join(' · '),
      aide: !F ? '' : !admin ? 'Préparation, envoi et clôture sont faits par Alexandre.'
        : !F.preparee ? 'Préparez les questionnaires, saisissez la feuille papier des adresses, puis notez sa destruction.'
        : !fEnv ? (F.aujourdhui < F.j90 ? 'Envoi possible à partir du ' + frDate(F.j90) + '.' : 'Vérifiez l’aperçu, envoyez-vous un test, puis envoyez.')
        : !fFerme ? 'Vérifiez la remise dans les 24 h ; fermez les questionnaires à la date limite.'
        : fdocs.length ? '' : 'Produisez le bilan à froid : Claude vérifie son empreinte et le range dans 7_Evaluations.',
      boutons: F ? '<button class="' + (admin && (!F.preparee || !fdocs.length && (fFerme || F.aujourdhui >= F.j90)) ? 'primary' : '') + '" data-froid="1">' + (admin ? 'Ouvrir l’à froid' : 'Voir l’à froid') + '</button>' : '' });
    return E;
  }
  const nomF = cle => ((d.formateurs || []).find(f => f.cle === cle) || { nom: cle }).nom;

  function rendre() {
    const s = d.session, E = etapes(), suivante = E.find(e => !e.fait && e.boutons);
    zone.innerHTML =
      '<div class="row" style="justify-content:space-between;align-items:center"><p class="muted" style="margin:0">Bilans Qualiopi de la session, étape par étape. Le papier reste toujours possible.</p><button id="bMaj" class="small">Actualiser</button></div>' +
      (!s.publiee ? '<div class="note" style="margin-top:10px">Bilans préparés par Claude, pas encore visibles d’Antoine. Vérifiez les objectifs et les critères ci-dessous, puis validez.' + (d.moi.role === 'admin' ? ' <button class="primary" id="bPub" style="margin-top:8px">Valider pour les formateurs</button>' : '') + '</div>' : '') +
      (s.fictive ? '<p style="margin-top:8px"><span class="chip">Session fictive</span></p>' : '') +
      (suivante ? '<div class="note" style="margin-top:10px"><b>Prochaine étape :</b> ' + esc(suivante.titre) + ' — ' + esc(suivante.quand) + '</div>' : '') +
      '<div class="panel" style="margin-top:12px">' + E.map((e, i) =>
        '<div class="bil-etape' + (e.fait ? ' fait' : e === suivante ? ' maintenant' : '') + '"><div class="bil-num">' + (e.fait ? '✓' : i + 1) + '</div><div class="bil-corps">' +
        '<b>' + esc(e.titre) + '</b><span class="muted small">' + esc(e.quand) + '</span><span class="small">' + e.txt + '</span>' +
        (e.aide ? '<span class="muted small">' + esc(e.aide) + '</span>' : '') + (e.boutons ? '<div class="row">' + e.boutons + '</div>' : '') + '</div></div>').join('') + '</div>' +
      '<details class="panel" style="margin-top:12px"><summary><b>Objectifs et critères de cette session</b></summary>' +
      '<p class="small" style="margin-top:8px"><b>Objectifs du programme</b> (repris au positionnement et à l’évaluation à chaud)</p><ol class="small">' + s.objectifs.map(o => '<li>' + esc(o) + '</li>').join('') + '</ol>' +
      '<p class="small"><b>Critères de la grille des acquis</b></p><ol class="small">' + s.criteres.map(c => '<li><b>' + esc(c.titre) + '</b>' + (c.indicateurs ? ' — <span class="muted">' + esc(c.indicateurs) + '</span>' : '') + '</li>').join('') + '</ol>' +
      (d.moi.role === 'admin' ? '<div class="row"><button class="small" id="bVerif">Vérifier l’intégrité</button></div>' : '') + '</details>';
    const on = (id, f) => { const b = $(id); if (b) b.onclick = () => f(b); };
    on('bMaj', () => afficher());
    on('bPub', b => action(b, async () => { await rpc('bil_publier', { p_session: s.id, p_publiee: true }); toast('Bilans visibles des formateurs'); afficher(true); }));
    on('bVerif', b => action(b, async () => { const r = await rpc('bil_verifier', { p_session: s.id }); informer(esc(r.ok ? 'Intégrité vérifiée : ' + r.lignes + ' enregistrements, chaîne d’empreintes intacte.' : 'ALERTE : ' + r.problemes.map(p => (p.table ? p.table + ' n°' + p.n + ' : ' : '') + p.probleme).join(' ; '))); }));
    const q = sel => zone.querySelectorAll(sel);
    q('[data-ouvrir]').forEach(b => b.onclick = async () => {
      const c = d.campagnes.find(x => x.id === b.dataset.ouvrir);
      if (!await confirmer(esc('Ouvrir « ' + NOM_TYPE[c.type] + ' » ? Les stagiaires pourront répondre avec le QR code jusqu’à la fermeture.'), 'Ouvrir')) return;
      action(b, async () => { const a = await rpc('bil_ouvrir', { p_campagne: c.id }); memo('qr_' + c.id, a); await afficher(true); pleinQR(c.id); });
    });
    q('[data-qr]').forEach(b => b.onclick = () => pleinQR(b.dataset.qr));
    q('[data-fermer]').forEach(b => b.onclick = async () => {
      const c = d.campagnes.find(x => x.id === b.dataset.fermer);
      if (!await confirmer(esc('Fermer « ' + NOM_TYPE[c.type] + ' » ? Plus aucune réponse par téléphone (la saisie du papier reste possible).'), 'Fermer')) return;
      action(b, async () => { const r = await rpc('bil_fermer', { p_campagne: c.id }); try { sessionStorage.removeItem('bil_qr_' + c.id); } catch (e) {} toast('Fermé : ' + r.reponses + ' réponse(s)'); afficher(true); });
    });
    q('[data-papier]').forEach(b => b.onclick = () => ecranPapier(b.dataset.papier));
    q('[data-voir]').forEach(b => b.onclick = () => ecranResultats(b.dataset.voir));
    q('[data-grille]').forEach(b => b.onclick = () => ecranGrille());
    q('[data-auto]').forEach(b => b.onclick = () => ecranAuto());
    q('[data-voirauto]').forEach(b => b.onclick = () => ecranLireAuto());
    q('[data-froid]').forEach(b => b.onclick = () => ecranFroid());
    q('[data-pdf]').forEach(b => b.onclick = () => action(b, async () => {
      toast('Production du PDF…');
      const { data: r, error } = await sb.functions.invoke('bilans-pdf', { body: { action: 'produire', session_id: s.id } });
      if (error || !r || !r.ok) throw new Error((r && r.erreur) || 'PDF impossible pour le moment.');
      toast('PDF version ' + r.version + ' produit' + (r.mail ? ' et envoyé par mail' : ''));
      await afficher(true);
    }));
    q('[data-lire]').forEach(b => b.onclick = () => action(b, async () => {
      const { data: r, error } = await sb.functions.invoke('bilans-pdf', { body: { action: 'lien', session_id: s.id, document_id: b.dataset.lire } });
      if (error || !r || !r.url) throw new Error('PDF indisponible pour le moment.');
      window.open(r.url, '_blank', 'noopener');
    }));
  }

  // ---------- QR plein écran
  function chargerQR() {
    if (window.qrcode) return Promise.resolve();
    if (!qrPret) qrPret = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = QR_LIB; s.onload = ok; s.onerror = () => { qrPret = null; ko(new Error('QR indisponible : donnez l’adresse et le code.')); }; document.head.appendChild(s); });
    return qrPret;
  }
  async function pleinQR(cid) {
    let a = memo('qr_' + cid); const c = () => d.campagnes.find(x => x.id === cid);
    if (!a) { try { a = await rpc('bil_nouveau_code', { p_campagne: cid }); memo('qr_' + cid, a); } catch (e) { toast(msgErr(e)); return; } }
    const N = (d.stagiaires || []).length;
    const p = ouvrirPlein('<div class="bil-qr"><div class="eyebrow">' + esc(d.session.intitule) + '</div><h2>' + esc(NOM_TYPE[c().type]) + ' : scannez pour répondre</h2>' +
      '<div class="qr" id="bQRimg"><span class="muted">QR…</span></div><div class="muted">ou ouvrez <b>' + esc(lienCourt()) + '</b> et tapez le code</div><div class="bil-code">' + esc(a.code) + '</div>' +
      '<div class="bil-cpt num" id="bCpt"></div><div class="row" style="justify-content:center"><button class="primary bil-big" id="bRet">Retour aux bilans</button><button id="bNouv">Nouveau code</button></div>' +
      '<p class="muted small">Environ 5 minutes. Chacun répond sur son propre téléphone ; sinon, version papier.</p></div>');
    const cpt = () => { const e = plein && plein.querySelector('#bCpt'); if (e && c()) e.textContent = c().nb + ' réponse' + (c().nb > 1 ? 's' : '') + ' sur ' + N; };
    cpt(); minuterie = setInterval(async () => { if (!plein || document.hidden) return; try { await charger(false); cpt(); } catch (e) {} }, 4000);
    p.querySelector('#bRet').onclick = () => { fermerPlein(); rendre(); };
    p.querySelector('#bNouv').onclick = e => action(e.target, async () => { const n = await rpc('bil_nouveau_code', { p_campagne: cid }); memo('qr_' + cid, n); pleinQR(cid); });
    try {
      await chargerQR(); const q = window.qrcode(0, 'M'); q.addData(lienRepondre(a.jeton)); q.make();
      const box = plein && plein.querySelector('#bQRimg'); if (box) box.innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    } catch (e) { const box = plein && plein.querySelector('#bQRimg'); if (box) box.innerHTML = '<p>' + esc(e.message) + '</p>'; }
  }

  // ---------- saisie d'un questionnaire papier
  function ecranPapier(cid, retour) {
    const c = d.campagnes.find(x => x.id === cid), m = d.modeles[c.modele_id], pos = c.type === 'positionnement';
    const deja = new Set(reps(c).map(r => r.stagiaire_id));
    const libres = (d.stagiaires || []).filter(x => !deja.has(x.id));
    if (pos && !libres.length) { toast('Tous les stagiaires ont déjà un positionnement.'); return; }
    const p = ouvrirPlein('<div class="eyebrow">Saisie d’un questionnaire papier · ' + esc(NOM_TYPE[c.type]) + '</div><h2>Recopiez la feuille</h2>' +
      '<p class="muted">Recopiez exactement ce qui est coché ou écrit ; laissez vide ce qui ne l’est pas. La feuille reste scannée dans 7_Evaluations.</p>' +
      (pos ? '<label class="f">Stagiaire<select id="pSt"><option value="">— choisir —</option>' + libres.map(x => '<option value="' + x.id + '">' + esc(x.nom) + '</option>').join('') + '</select></label>' : '') +
      '<div id="pQ"></div><div class="note">Une fois enregistrée, la saisie ne se modifie plus.</div>' +
      '<button class="primary bil-big" id="pOk">Enregistrer la saisie</button><button id="pAnn">Annuler</button>');
    const f = QUEST.rendre(p.querySelector('#pQ'), m.contenu, d.session.objectifs, {});
    p.querySelector('#pAnn').onclick = () => { if (retour) retour(); else fermerPlein(); };
    p.querySelector('#pOk').onclick = async e => {
      const st = pos ? p.querySelector('#pSt').value : null;
      if (pos && !st) { toast('Choisissez le stagiaire.'); return; }
      const r = f.lire(); if (!Object.keys(r).length && !await confirmer(esc('Aucune réponse saisie : enregistrer une feuille vide ?'), 'Enregistrer')) return;
      action(e.target, async () => { await rpc('bil_saisir_papier', { p_campagne: cid, p_stagiaire: st, p_contenu: r }); toast('Saisie enregistrée');
        if (retour) { await charger(); retour(); } else { fermerPlein(); afficher(true); } });
    };
  }

  // ---------- grille d'appréciation des acquis
  function ecranGrille() {
    const s = d.session, valide = !!d.validation, A = {};
    (d.acquis || []).forEach(a => { A[a.stagiaire_id + '|' + a.critere] = a.niveau; });
    const vide = () => (d.stagiaires.length * s.criteres.length) - Object.keys(A).length;
    const p = ouvrirPlein('<div class="eyebrow">Appréciation des acquis · ' + esc(d.session.code) + '</div><h2>' + (valide ? 'Grille validée le ' + esc(d.validation.le) : 'Grille des acquis') + '</h2>' +
      '<p class="muted small">Complétée par les formateurs à partir de l’ensemble des productions. Non notée ; non remise au participant ; alimente l’attestation de fin de formation.</p>' +
      '<details class="panel"><summary><b>Critères et indicateurs observables</b></summary><ol class="small">' + s.criteres.map(c => '<li><b>' + esc(c.titre) + '</b> — ' + esc(c.indicateurs || '') + '</li>').join('') + '</ol></details>' +
      d.stagiaires.map(x => '<details class="panel" data-st="' + x.id + '"><summary><b>' + esc(x.nom) + '</b> <span class="muted small" data-cpt="' + x.id + '"></span></summary>' +
        s.criteres.map((c, i) => '<div class="bil-crit"><span class="small"><b>' + (i + 1) + '. ' + esc(c.titre) + '</b></span><div class="bil-niv">' +
          NIV.map(([v, l]) => '<button type="button" class="' + (v === 'a_renforcer' ? 'ar' : v === 'en_cours' ? 'ec' : '') + '" data-n="' + x.id + '|' + (i + 1) + '|' + v + '" aria-pressed="' + (A[x.id + '|' + (i + 1)] === v) + '"' + (valide ? ' disabled' : '') + '>' + l + '</button>').join('') + '</div></div>').join('') +
        '<label class="f small" style="margin-top:8px">Commentaire des formateurs<textarea rows="2" maxlength="1000" data-com="' + x.id + '"' + (valide ? ' disabled' : '') + '>' + esc((d.commentaires || {})[x.id] || '') + '</textarea></label></details>').join('') +
      (valide ? '' : '<div class="note" id="gEtat"></div><button class="primary bil-big" id="gVal">Valider la grille (définitif)</button>') + '<button id="gRet">Retour aux bilans</button>');
    const maj = () => {
      d.stagiaires.forEach(x => { const n = s.criteres.filter((_, i) => A[x.id + '|' + (i + 1)]).length; const e = p.querySelector('[data-cpt="' + x.id + '"]'); if (e) e.textContent = n + '/' + s.criteres.length; });
      const g = p.querySelector('#gEtat'); if (g) g.textContent = vide() ? vide() + ' case(s) encore vide(s). Un stagiaire absent peut rester vide.' : 'Toutes les cases sont remplies.';
    };
    maj();
    p.querySelector('#gRet').onclick = () => { fermerPlein(); afficher(true); };
    p.querySelectorAll('[data-n]').forEach(b => b.onclick = async () => {
      const [st, cr, v] = b.dataset.n.split('|'), k = st + '|' + cr, nouveau = A[k] === v ? null : v;
      const groupe = b.parentNode.querySelectorAll('button'); groupe.forEach(x => x.disabled = true);
      try {
        await rpc('bil_acquis', { p_session: s.id, p_stagiaire: st, p_critere: +cr, p_niveau: nouveau });
        if (nouveau) A[k] = nouveau; else delete A[k];
        groupe.forEach(x => x.setAttribute('aria-pressed', x.dataset.n === st + '|' + cr + '|' + A[k]));
      } catch (e) { toast(msgErr(e)); } finally { groupe.forEach(x => x.disabled = false); maj(); }
    });
    p.querySelectorAll('[data-com]').forEach(t => t.onchange = async () => {
      try { await rpc('bil_acquis_commentaire', { p_session: s.id, p_stagiaire: t.dataset.com, p_texte: t.value }); toast('Commentaire enregistré'); } catch (e) { toast(msgErr(e)); }
    });
    const bv = p.querySelector('#gVal');
    if (bv) bv.onclick = async () => {
      if (!await confirmer('Valider la grille ? Elle ne sera plus modifiable.' + (vide() ? '<br><br><b>Attention :</b> ' + vide() + ' case(s) vide(s).' : ''), 'Valider')) return;
      action(bv, async () => { await rpc('bil_valider_grille', { p_session: s.id }); toast('Grille validée'); fermerPlein(); afficher(true); });
    };
  }

  // ---------- auto-évaluation
  function idAuto() { return Object.keys(d.modeles).find(k => d.modeles[k].type === 'autoevaluation'); }
  function ecranAuto() {
    const m = d.modeles[idAuto()];
    const p = ouvrirPlein('<div class="eyebrow">' + esc(d.session.intitule) + ' · ' + esc(d.session.dates) + '</div><h2>Mon auto-évaluation</h2><p class="muted">' + esc(m.contenu.intro || '') + '</p>' +
      '<div id="aQ"></div><div class="note">Une fois envoyée, l’auto-évaluation ne se modifie plus.</div><button class="primary bil-big" id="aOk">Envoyer</button><button id="aAnn">Annuler</button>');
    const f = QUEST.rendre(p.querySelector('#aQ'), m.contenu, d.session.objectifs, {});
    p.querySelector('#aAnn').onclick = () => fermerPlein();
    p.querySelector('#aOk').onclick = async e => { if (!await confirmer('Envoyer votre auto-évaluation ?', 'Envoyer')) return;
      action(e.target, async () => { await rpc('bil_autoevaluer', { p_session: d.session.id, p_contenu: f.lire() }); toast('Auto-évaluation enregistrée'); fermerPlein(); afficher(true); }); };
  }
  function ecranLireAuto() {
    const html = (d.autoevaluations || []).map(a => '<div class="panel"><h3>' + esc(nomF(a.formateur)) + ' <span class="muted small">' + esc(a.le) + '</span></h3>' + resume(d.modeles[a.modele_id].contenu, [a.contenu], true) + '</div>').join('');
    const p = ouvrirPlein('<h2>Auto-évaluations</h2>' + html + '<button id="xRet">Retour aux bilans</button>');
    p.querySelector('#xRet').onclick = () => fermerPlein();
  }

  // ---------- résultats (positionnement : nominatif ; à chaud : global)
  function resume(modele, liste, detail, objectifs, nomsParId) {
    let h = '';
    (modele.sections || []).forEach(sec => {
      let b = '';
      sec.questions.forEach(q => {
        const vals = liste.map(r => r[q.id]).filter(v => v !== undefined && v !== null && v !== '');
        if (q.type === 'objectifs') {
          (objectifs || []).forEach((o, i) => { const l = vals.map(v => v[i]).filter(x => x); const m = moy(l);
            b += '<div class="bil-res"><span class="l">' + esc(o) + '</span><div class="bil-barre"><div style="width:' + (m ? (m - 1) / 3 * 100 : 0) + '%"></div></div><span class="v">' + nf(m) + '/4</span></div>'; });
          b += '<p class="muted small">1 = pas du tout · 4 = tout à fait · ' + vals.length + ' réponse(s)</p>';
        } else if (q.type === 'echelle') {
          const m = moy(vals); b += '<div class="bil-res"><span class="l">' + esc(q.libelle) + '</span><div class="bil-barre"><div style="width:' + (m ? (m - 1) / 4 * 100 : 0) + '%"></div></div><span class="v">' + nf(m) + '/5</span></div>';
        } else if (q.type === 'choix' || q.type === 'multi') {
          const n = {}; vals.forEach(v => [].concat(v).forEach(x => { n[x] = (n[x] || 0) + 1; }));
          b += '<p class="small" style="margin-top:6px"><b>' + esc(q.libelle) + '</b><br>' + (q.options.map(o => esc(o) + ' : <b>' + (n[o] || 0) + '</b>').join(' · ')) + '</p>';
          if (detail && q.commentaire) liste.forEach(r => { if (r[q.id + '_com']) b += '<div class="bil-txt">' + esc(r[q.id + '_com']) + '</div>'; });
          if (q.autre) liste.forEach(r => { if (r[q.id + '_autre']) b += '<div class="bil-txt">Autre : ' + esc(r[q.id + '_autre']) + '</div>'; });
          if (nomsParId && q.id === 'q5') { const noms = liste.filter(r => String(r.q5 || '').startsWith('Oui')).map(r => nomsParId(r)); if (noms.length) b += '<div class="note small">À appeler par le référent handicap : ' + noms.map(esc).join(', ') + '</div>'; }
        } else if (q.type === 'texte') {
          if (vals.length) b += '<p class="small" style="margin-top:6px"><b>' + esc(q.libelle) + '</b></p>' + liste.filter(r => r[q.id]).map(r => '<div class="bil-txt">' + (nomsParId ? '<b>' + esc(nomsParId(r)) + ' : </b>' : '') + esc(r[q.id]) + '</div>').join('');
        }
      });
      if (b) h += '<div style="margin-top:8px"><p class="eyebrow" style="margin:8px 0 4px">' + esc(sec.titre) + '</p>' + b + '</div>';
    });
    return h;
  }
  function ecranResultats(cid, retour) {
    const c = d.campagnes.find(x => x.id === cid), m = d.modeles[c.modele_id], liste = reps(c), pos = c.type === 'positionnement';
    const noms = {}; (d.stagiaires || []).forEach(x => { noms[x.id] = x.nom; });
    const nomR = r => noms[r.stagiaire_id] || '?';
    let comp = '';
    if (c.type === 'chaud' || c.type === 'froid_stagiaire') { // progression positionnement → fin de formation (→ à froid)
      const froid = c.type === 'froid_stagiaire', lp = reps(camp('positionnement')), lc = froid ? reps(camp('chaud')) : liste;
      const m = (l, i) => moy(l.map(r => (r.contenu.obj || [])[i]).filter(x => x));
      comp = '<div class="panel"><h3>Progression sur les objectifs</h3>' + d.session.objectifs.map((o, i) =>
        '<div class="bil-res"><span class="l">' + esc(o) + '</span><span class="v">' + nf(m(lp, i)) + '</span><span>→</span><span class="v">' + (froid ? nf(m(lc, i)) + '</span><span>→</span><span class="v"><b>' + nf(m(liste, i)) + '</b>' : '<b>' + nf(m(lc, i)) + '</b>') + '</span></div>'
      ).join('') + '<p class="muted small">' + (froid ? 'Moyenne sur 4 au positionnement → en fin de formation → à froid. Réponses anonymes : comparaison du groupe, pas des personnes.' : 'Moyenne sur 4 au positionnement → en fin de formation.') + '</p></div>';
    }
    const p = ouvrirPlein('<div class="eyebrow">' + esc(d.session.intitule) + '</div><h2>' + esc(NOM_TYPE[c.type]) + ' · ' + liste.length + ' réponse(s)</h2>' +
      (pos ? '<p class="muted small">Réponses nominatives, pour adapter la formation. Les demandes d’aménagement ne contiennent aucun détail.</p>' : '<p class="muted small">Réponses sans nom (sauf nom laissé volontairement).</p>') +
      comp + '<div class="panel">' + resume(m.contenu, liste.map(r => Object.assign({ __s: r.stagiaire_id }, r.contenu)), false, d.session.objectifs, pos ? r => noms[r.__s] || '?' : null) + '</div>' +
      (pos ? '<details class="panel"><summary><b>Qui a répondu</b></summary><ul class="list">' + d.stagiaires.map(x => '<li><div>' + esc(x.nom) + '</div><span class="small">' + (liste.some(r => r.stagiaire_id === x.id) ? (liste.find(r => r.stagiaire_id === x.id).mode === 'papier' ? 'papier' : 'téléphone') : '<span class="muted">pas encore</span>') + '</span></li>').join('') + '</ul></details>' : '') +
      '<button id="rRet">Retour aux bilans</button>');
    p.querySelector('#rRet').onclick = () => { if (retour) retour(); else fermerPlein(); };
    void nomR;
  }

  // ---------- évaluations à froid (lot B) : un seul écran ; actions réservées à Alexandre, lecture des nombres pour les formateurs.
  // Aucune adresse de stagiaire n'est jamais affichée : la base ne renvoie que des nombres.
  const NIVEAU = { rouge: ['✗', 'r'], orange: ['!', 'o'], vert: ['✓', 'v'] };
  const REMISE = { delivre: 'délivré', rejete: 'rejeté', en_cours: 'en cours', inconnu: 'inconnu' };
  const EVT = { froid_prepare: 'Préparation', froid_adresses_papier: 'Adresses du papier saisies', froid_feuille_detruite: 'Feuille papier détruite',
    froid_effacement_demande: 'Adresse effacée sur demande', froid_test: 'Test demandé', froid_test_envoye: 'Test envoyé au Gmail', froid_test_echec: 'Échec du test',
    ouverture: 'Questionnaires ouverts', froid_envoi: 'Envoi', froid_envoi_erreur: 'Erreur pendant l’envoi', froid_recap_envoye: 'Récapitulatif envoyé au Gmail',
    froid_recap_echec: 'Échec du récapitulatif', froid_remise: 'Remise relevée', froid_journal_brevo_purge: 'Journal Brevo supprimé',
    froid_ids_brevo_effaces: 'Identifiants Brevo effacés', froid_effacement_6_mois: 'Adresses effacées (6 mois)', froid_pdf_produit: 'Bilan à froid produit',
    froid_pdf_mail_envoye: 'Bilan à froid envoyé au Gmail', froid_pdf_mail_echec: 'Bilan à froid non envoyé par mail', froid_pdf_echec: 'Échec du bilan à froid' };
  // détail du journal : seulement les nombres et les mots courts (jamais d'empreinte, de chemin ni d'identifiant)
  function detailJ(o) {
    const plat = Object.assign({}, o || {}, (o && o.stagiaires) || {});
    return Object.entries(plat).filter(([k, v]) => ['number', 'boolean'].includes(typeof v) || (typeof v === 'string' && v.length <= 40 && !/sha|chemin|brevo|modele|objet|destinataire|cci|expediteur|fichier/.test(k)))
      .map(([k, v]) => k.replace(/_/g, ' ') + ' : ' + (v === true ? 'oui' : v === false ? 'non' : v)).join(', ');
  }
  function ecranFroid() {
    const F = d.froid, s = d.session, admin = d.moi.role === 'admin';
    if (!F) { toast('À froid indisponible pour le moment.'); return; }
    const FS = camp('froid_stagiaire'), FR = camp('froid_responsable'), docs = F.documents || [];
    const ouvertes = [FS, FR].filter(c => c && c.etat === 'ouverte'), fermees = !!(FS && FR && FS.etat === 'fermee' && FR.etat === 'fermee');
    const env = F.envoi || {}, ap = F.apercu || {}, limitePassee = !!F.date_limite && F.aujourdhui >= F.date_limite;
    const typeCourt = c => c.type === 'froid_stagiaire' ? 'stagiaire' : 'établissement';
    let h = '<div class="eyebrow">' + esc(s.intitule) + ' · ' + esc(s.dates) + '</div><h2>Évaluations à froid</h2>' +
      (F.fictive ? '<p><span class="chip">Session fictive</span> <span class="muted small">seules des adresses de 2A Formation sont permises</span></p>' : '');
    // état
    h += '<div class="panel"><div class="small">Envoi possible à partir du <b>' + frDate(F.j90) + '</b> · réponses jusqu’au <b>' + frDate(F.date_limite || F.limite_prevue) + '</b>' + (F.date_limite ? '' : ' (date prévue)') +
      ' · adresses effacées d’office le ' + frDate(F.effacement_auto) + '</div>' +
      '<div class="small" style="margin-top:6px"><b>' + F.adresses + '</b> adresse' + (F.adresses > 1 ? 's' : '') + ' en attente d’envoi' + (F.feuille_detruite_le ? ' · feuille papier détruite le ' + frDate(F.feuille_detruite_le) : '') + '</div>' +
      (env.envoye_le ? '<div class="small" style="margin-top:6px">Envoyé le ' + esc(env.envoye_le) + (env.envoye_par ? ' par ' + esc(env.envoye_par) : '') + (env.m3_envoye_le ? ' · établissement le ' + esc(env.m3_envoye_le) : ' · établissement pas encore joint') + ' · ' + env.essais + ' essai(s)</div>' : '') +
      (env.en_cours ? '<div class="note small" style="margin-top:6px">Un envoi est en cours : attendez la fin avant toute autre action.</div>' : '') +
      ([FS, FR].some(Boolean) ? '<div class="small" style="margin-top:6px">' + [FS, FR].filter(Boolean).map(c => esc(NOM_TYPE[c.type]) + ' : ' + c.nb + ' réponse' + (c.nb > 1 ? 's' : '') + (c.nb_papier ? ' (dont ' + c.nb_papier + ' du papier)' : '') + ' ' + chip(c.etat)).join(' · ') + '</div>' : '') + '</div>';
    if (admin && !F.preparee) h += '<div class="panel"><h3>Préparer</h3><p class="muted small">Crée les deux questionnaires (encore fermés), leurs liens communs à la session et la date limite. Rien n’est envoyé.</p><button class="primary" id="fPrep">Préparer l’à froid</button></div>';
    if (admin) {
      h += '<div class="panel"><h3>Adresses des stagiaires</h3>' +
        '<p class="muted small">Recopiez la feuille papier « Questionnaire à froid », une adresse par ligne. Les adresses ne s’affichent jamais ; une adresse invalide arrête toute la saisie.</p>' +
        '<textarea id="fAdr" rows="4" autocomplete="off" spellcheck="false" placeholder="une adresse par ligne"></textarea><div class="row"><button id="fAdrOk">Enregistrer les adresses</button></div>' +
        (F.preparee && !F.feuille_detruite_le ? '<div class="row" style="margin-top:10px;align-items:center"><label class="small">Feuille papier détruite le <input type="date" id="fDetr" min="' + esc(s.dernier_jour) + '" max="' + esc(F.aujourdhui) + '"></label><button id="fDetrOk">Noter</button></div>' : '') +
        '<div class="row" style="margin-top:10px;align-items:center"><input type="email" id="fEff" placeholder="adresse à effacer (demande d’une personne)" autocomplete="off" style="flex:1;min-width:200px"><button id="fEffOk">Effacer cette adresse</button></div></div>';
      if (F.preparee) {
        h += '<div class="panel"><h3>Contrôles avant l’envoi</h3>' + (F.controles || []).map(c => { const n = NIVEAU[c.niveau] || ['?', '']; return '<div class="bil-ctl"><span class="' + n[1] + '">' + n[0] + '</span><div><b>' + esc(c.libelle) + '</b><div class="muted small">' + esc(c.detail || '') + '</div></div></div>'; }).join('') + '</div>';
        if (ap.stagiaire) h += '<details class="panel"><summary><b>Aperçu du mail aux stagiaires</b> <span class="muted small">un mail par adresse, aucune copie</span></summary><p class="small"><b>Objet :</b> ' + esc(ap.stagiaire.objet) + '</p><div class="bil-txt">' + esc(ap.stagiaire.texte) + '</div></details>';
        if (ap.etablissement) h += '<details class="panel"><summary><b>Aperçu du mail à l’établissement</b> <span class="muted small">à ' + esc(ap.etablissement.destinataire || '–') + ', copie cachée au Gmail</span></summary><p class="small"><b>Objet :</b> ' + esc(ap.etablissement.objet) + '</p><div class="bil-txt">' + esc(ap.etablissement.texte) + '</div></details>';
        if (F.liens) h += '<p class="small muted">Questionnaires : <a href="' + esc(F.liens.stagiaires) + '" target="_blank" rel="noopener">stagiaires</a> · <a href="' + esc(F.liens.responsable) + '" target="_blank" rel="noopener">établissement</a> (liens communs à la session)</p>';
        const peut = !F.rouges && !env.en_cours;
        h += '<div class="panel"><h3>Envoyer</h3><div class="row" style="align-items:center"><button id="fTest">M’envoyer un test</button><span class="muted small">les deux mails, marqués [TEST], à 2aa.formation@gmail.com seulement</span></div>' +
          '<p class="small" style="margin-top:10px"><b>Documents contrôlés par</b> <label><input type="radio" name="fPar" value="Antoine"> Antoine</label> <label><input type="radio" name="fPar" value="Alexandre"> Alexandre</label></p>' +
          '<div class="row" style="align-items:center"><button class="primary" id="fEnv"' + (peut ? '' : ' disabled') + '>' + (env.envoye_le ? 'Nouvel essai' : 'Envoyer') + '</button>' +
          (peut ? '' : '<span class="muted small">' + (env.en_cours ? 'Envoi en cours.' : 'Bloqué : ' + F.rouges + ' contrôle(s) rouge(s).') + '</span>') + '</div><div id="fConf" hidden></div><div id="fRes"></div></div>';
        if (env.envoye_le) h += '<div class="panel"><h3>Remise des mails</h3><p class="muted small">À relever dans les 24 h qui suivent l’envoi : le journal Brevo des mails aux stagiaires est ensuite supprimé.</p><div class="row"><button id="fRem">Vérifier la remise</button></div><div id="fRemRes" class="small" style="margin-top:6px"></div></div>';
      }
    }
    // réponses et clôture
    if (FS || FR) {
      const bts = [FS, FR].filter(Boolean).map(c => (admin ? '<button data-fpap="' + c.id + '">Saisir un questionnaire papier (' + typeCourt(c) + ')</button>' : '') +
        (c.etat === 'fermee' && c.nb ? '<button data-fvoir="' + c.id + '">Résultats (' + typeCourt(c) + ')</button>' : '')).join('');
      h += '<div class="panel"><h3>Réponses</h3>' + (bts ? '<div class="row">' + bts + '</div>' : '<p class="muted small">Les résultats s’affichent une fois les questionnaires fermés.</p>') +
        (admin && ouvertes.length ? '<div class="row" style="margin-top:10px;align-items:center"><button id="fFerm">Fermer les questionnaires à froid</button>' + (limitePassee ? '' : '<span class="muted small">date limite le ' + frDate(F.date_limite) + '</span>') + '</div>' : '') + '</div>';
    }
    // bilan à froid
    h += '<div class="panel"><h3>Bilan à froid (PDF)</h3><p class="muted small">' + (fermees ? 'Taux de réponse, objectifs au début, en fin de formation et à froid, appréciations, points à reporter au plan d’amélioration. Envoyé au Gmail ; Claude vérifie l’empreinte et le range dans 7_Evaluations.' : 'Disponible une fois les deux questionnaires à froid fermés.') + '</p>' +
      ((admin && fermees) || docs.length ? '<div class="row">' + (admin && fermees ? '<button class="' + (docs.length ? '' : 'primary') + '" id="fPdf">' + (docs.length ? 'Produire une nouvelle version' : 'Produire le bilan à froid') + '</button>' : '') +
        docs.map(o => '<button data-flire="' + o.id + '">Ouvrir la version ' + o.version + ' du ' + esc(o.le) + '</button>').join('') + '</div>' : '') + '</div>';
    if ((F.journal || []).length) h += '<details class="panel"><summary><b>Journal</b> <span class="muted small">nombres seulement, aucune adresse</span></summary><ul class="list small" style="margin-top:6px">' +
      F.journal.slice().reverse().map(j => '<li><div><b>' + esc(EVT[j.evenement] || j.evenement) + '</b> <span class="muted">' + esc(j.le) + ' · ' + esc(j.auteur) + '</span>' + (detailJ(j.detail) ? '<div class="muted">' + esc(detailJ(j.detail)) + '</div>' : '') + '</div></li>').join('') + '</ul></details>';
    h += '<button id="fRet">Retour aux bilans</button>';
    const p = ouvrirPlein(h);
    const on = (id, f) => { const b = p.querySelector('#' + id); if (b) b.onclick = () => f(b); };
    const recharger = async () => { await charger(); ecranFroid(); };
    on('fRet', () => { fermerPlein(); rendre(); });
    on('fPrep', b => action(b, async () => { const r = await rpc('bil_froid_preparer', { p_session: s.id }); toast(r.deja ? 'Déjà préparé' : 'À froid préparé : réponses jusqu’au ' + frDate(r.date_limite)); await recharger(); }));
    on('fAdrOk', b => {
      const t = p.querySelector('#fAdr').value; if (!t.trim()) { toast('Aucune adresse saisie.'); return; }
      action(b, async () => { const r = await rpc('bil_froid_saisir_papier', { p_session: s.id, p_adresses: t }); toast(r.ajoutees + ' adresse(s) ajoutée(s)' + (r.deja_presentes ? ', ' + r.deja_presentes + ' déjà présente(s)' : '') + ' · ' + r.total + ' en attente'); await recharger(); });
    });
    on('fDetrOk', async b => {
      const v = p.querySelector('#fDetr').value; if (!v) { toast('Indiquez la date de destruction.'); return; }
      if (!await confirmer('Noter que la feuille papier des adresses a été détruite le <b>' + esc(frDate(v)) + '</b> ? Cette date ne se modifie plus.', 'Noter')) return;
      action(b, async () => { await rpc('bil_froid_feuille_detruite', { p_session: s.id, p_le: v }); toast('Destruction notée'); await recharger(); });
    });
    on('fEffOk', b => {
      const v = p.querySelector('#fEff').value.trim(); if (!v) { toast('Saisissez l’adresse à effacer.'); return; }
      action(b, async () => { const r = await rpc('bil_froid_effacer_adresse', { p_email: v }); p.querySelector('#fEff').value = '';
        await recharger(); informer(r.trouvee ? 'Adresse trouvée et effacée (dans toutes les sessions).' : 'Adresse introuvable : jamais saisie ou déjà effacée.'); });
    });
    on('fTest', b => action(b, async () => { toast('Envoi du test…'); await fn('envois-brevo', { action: 'froid_test', session_id: s.id }); toast('Test envoyé à 2aa.formation@gmail.com'); await recharger(); }));
    on('fEnv', b => {
      const par = (p.querySelector('input[name=fPar]:checked') || {}).value;
      if (!par) { toast('Cochez « Documents contrôlés par » : Antoine ou Alexandre.'); return; }
      const box = p.querySelector('#fConf'); box.hidden = false;
      box.innerHTML = '<div class="note" style="margin-top:10px"><b>Envoyer maintenant ?</b><div class="small" style="margin-top:4px">' +
        (F.adresses ? F.adresses + ' mail(s) aux stagiaires, un par adresse, sans aucune copie ; chaque adresse acceptée par Brevo est effacée aussitôt.' : 'Aucun mail aux stagiaires (aucune adresse).') +
        (env.m3_envoye_le ? ' Le mail à l’établissement est déjà parti : il ne repart pas.' : ap.etablissement ? ' Mail à l’établissement : ' + esc(ap.etablissement.destinataire || '–') + ', copie cachée au Gmail.' : '') +
        ' Les deux questionnaires s’ouvrent aux réponses. Documents contrôlés par ' + esc(par) + '.</div><div class="row" style="margin-top:8px"><button class="primary" id="fOui">Confirmer l’envoi</button><button id="fNon">Annuler</button></div></div>';
      p.querySelector('#fNon').onclick = () => { box.hidden = true; box.innerHTML = ''; };
      p.querySelector('#fOui').onclick = e => action(e.target, async () => {
        b.disabled = true; p.querySelector('#fNon').disabled = true;
        box.insertAdjacentHTML('beforeend', '<p class="small"><b>Envoi en cours…</b> Ne fermez pas cette page (jusqu’à 2 minutes).</p>');
        let r;
        try { r = await fn('envois-brevo', { action: 'froid_envoyer', session_id: s.id, controle_par: par }); }
        catch (x) { await recharger(); throw x; }
        await recharger();
        const res = plein && plein.querySelector('#fRes');
        if (res) res.innerHTML = '<div class="note" style="margin-top:10px"><b>Envoi terminé.</b> Stagiaires : ' + r.envoyes + ' mail(s) envoyé(s), ' + r.effacees + ' adresse(s) effacée(s), ' + r.echecs + ' échec(s), ' + r.restantes + ' adresse(s) restante(s). Établissement : ' + esc(r.etablissement) + '. Récapitulatif au Gmail : ' + (r.recap ? 'envoyé' : 'non envoyé') + '.' +
          (r.alerte ? '<div style="margin-top:6px;color:var(--bad);font-weight:700">' + esc(r.alerte) + '</div>' : '') + '</div>';
      });
    });
    on('fRem', b => action(b, async () => {
      const r = await fn('envois-brevo', { action: 'froid_remise', session_id: s.id }); await recharger();
      const x = plein && plein.querySelector('#fRemRes');
      if (x) x.textContent = 'Stagiaires : ' + r.delivre + ' délivré(s), ' + r.rejete + ' rejeté(s), ' + r.en_cours + ' en cours · établissement : ' + (REMISE[r.etablissement] || r.etablissement) + '.';
    }));
    on('fFerm', async b => {
      if (!await confirmer('Fermer ' + ouvertes.map(c => '« ' + esc(NOM_TYPE[c.type]) + ' »').join(' et ') + ' ?' + (limitePassee ? '' : '<br><br><b>Attention :</b> la date limite annoncée (' + esc(frDate(F.date_limite)) + ') n’est pas passée.') + '<br><br>Plus aucune réponse en ligne ; la saisie du papier reste possible.', 'Fermer')) return;
      action(b, async () => { let n = 0; for (const c of ouvertes) { const r = await rpc('bil_fermer', { p_campagne: c.id }); n += (r && r.reponses) || 0; } toast('Questionnaires à froid fermés : ' + n + ' réponse(s)'); await recharger(); });
    });
    on('fPdf', b => action(b, async () => { toast('Production du bilan à froid…'); const r = await fn('bilans-pdf', { action: 'froid', session_id: s.id }); toast('Bilan à froid version ' + r.version + ' produit' + (r.mail ? ' et envoyé au Gmail' : '')); await recharger(); }));
    p.querySelectorAll('[data-flire]').forEach(x => x.onclick = () => action(x, async () => { const r = await fn('bilans-pdf', { action: 'lien', session_id: s.id, document_id: x.dataset.flire }); window.open(r.url, '_blank', 'noopener'); }));
    p.querySelectorAll('[data-fpap]').forEach(x => x.onclick = () => ecranPapier(x.dataset.fpap, ecranFroid));
    p.querySelectorAll('[data-fvoir]').forEach(x => x.onclick = () => ecranResultats(x.dataset.fvoir, ecranFroid));
  }

  function monter(el, c) { if (!sb || !el) return; if (code !== c) d = null; zone = el; code = c; afficher(); }
  function init(o) { sb = o.sb; toast = o.toast; esc = o.esc; $ = o.$; }
  return { init, monter, quitter: () => { fermerPlein(); } };
})();
