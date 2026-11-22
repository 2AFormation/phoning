// 2A Travail – déroulé formateurs (guide minute par minute d'une session).
// Sous-onglet « Déroulé » de la fiche formation : ce qui se passe maintenant et ensuite, puis le guide complet, imprimable.
// Fichier séparé : n'utilise de app.js que sb, toast, esc et $, transmis par DER.init(). Lecture seule :
// le guide est lu par la fonction contrôlée public.gui_deroule (réservée aux formateurs de la session et à l'admin).
// Le contenu n'est jamais dans le dépôt GitHub (public) : Claude l'importe dans Supabase après validation d'Alexandre.
'use strict';
const DER = (() => {
  let sb, toast, esc, $;
  let zone = null, code = null, d = null, minuteur = null;

  const css = document.createElement('style');
  css.textContent = `
  .der-now{border-left:5px solid var(--signal)}
  .der-now .k{font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}
  .der-now .s{font-family:var(--f-display);font-weight:800;font-size:19px;line-height:1.2;margin:2px 0 4px}
  .der-now .x{font-size:14px;opacity:.85}
  .der-kv{display:grid;grid-template-columns:105px 1fr;gap:3px 10px;font-size:14px}
  .der-kv b{font-weight:600;opacity:.75}
  .der-obj div{margin:4px 0;font-size:14px}
  .der-c{display:inline-block;min-width:26px;text-align:center;font-size:12px;font-weight:800;border-radius:6px;padding:1px 5px;margin-right:6px;background:var(--accent);color:var(--accent-ink)}
  .der-chip{display:inline-block;font-size:11.5px;font-weight:800;border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:0 7px;margin-left:4px;vertical-align:middle}
  .der-alerte{border-left:5px solid var(--warn)}
  .der-alerte li,.der-liste li{margin:4px 0;font-size:14px}
  .der-jour>summary{cursor:pointer;list-style:none;font-family:var(--f-display);font-weight:800;font-size:17px;padding:10px 12px;border-radius:10px;background:var(--accent);color:var(--accent-ink)}
  .der-jour>summary::-webkit-details-marker{display:none}
  .der-jour>summary .t{float:right;font-size:13px;font-weight:700;opacity:.85}
  .der-demi{margin:12px 0 4px}
  .der-demi .p{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--signal)}
  .der-demi h3{margin:2px 0}
  .der-demi .i{font-style:italic;color:var(--muted);font-size:14px;margin:2px 0 8px}
  .der-et{display:grid;grid-template-columns:96px 1fr;gap:2px 10px;padding:8px 6px;border-top:1px solid var(--line);font-size:14px}
  .der-et .h{font-weight:800;color:var(--accent);white-space:nowrap}
  .der-et .s{font-weight:700}
  .der-et .o{grid-column:2;font-size:13px;color:var(--muted)}
  .der-et.pause{color:var(--muted);font-style:italic;padding:4px 6px}
  .der-et.ici{background:color-mix(in srgb,var(--signal) 18%,transparent);border-radius:8px}
  .der-rv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
  .der-rv>div{border-radius:10px;padding:8px 10px;font-size:13.5px;background:var(--soft)}
  .der-rv h4{margin:0 0 3px;font-size:12px;letter-spacing:.5px;text-transform:uppercase}
  @media (max-width:560px){.der-rv{grid-template-columns:1fr}.der-et{grid-template-columns:78px 1fr}}
  @media print{
    body.der-imprime *{visibility:hidden}
    body.der-imprime #der-guide,body.der-imprime #der-guide *{visibility:visible}
    body.der-imprime #der-guide{position:absolute;left:0;top:0;width:100%;color:#000}
    body.der-imprime #der-guide .der-noprint{display:none}
    body.der-imprime .der-jour>summary{background:#2E5B4E;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body.der-imprime .der-et{break-inside:avoid}
  }
  `;
  document.head.appendChild(css);

  const msgErr = e => (e && (e.message || e.details)) || 'Lecture impossible pour le moment.';
  // date et heure de Paris, quel que soit le fuseau de l'appareil
  function paris() {
    const p = {}; new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).forEach(x => p[x.type] = x.value);
    return { jour: p.year + '-' + p.month + '-' + p.day, min: (+p.hour % 24) * 60 + (+p.minute) };
  }
  const minutes = t => { const m = String(t || '').trim().match(/^(\d{1,2})h(\d{2})?$/); return m ? +m[1] * 60 + (+(m[2] || 0)) : null; };
  const plage = h => { const [a, b] = String(h || '').split('-'); return [minutes(a), minutes(b)]; };

  // repère l'étape en cours (ou la prochaine) aujourd'hui
  function situer(g) {
    const n = paris(), j = (g.jours || []).find(x => x.date === n.jour);
    if (!j) return { jour: null };
    const liste = [];
    (j.demi || []).forEach((dm, di) => (dm.etapes || []).forEach((e, ei) => { const [a, b] = plage(e[0]); liste.push({ di, ei, a, b, e, dm }); }));
    let ici = liste.findIndex(x => x.a !== null && n.min >= x.a && n.min < x.b);
    let avant = false;
    if (ici < 0) { ici = liste.findIndex(x => x.a !== null && x.a > n.min); avant = ici >= 0; }
    return { jour: j, liste, ici, avant, n };
  }

  function blocMaintenant(g) {
    const s = situer(g);
    if (!s.jour) {
      const n = paris(), proch = (g.jours || []).find(x => x.date > n.jour);
      return '<div class="panel der-now der-noprint"><div class="k">Pas de formation aujourd’hui</div><div class="x">' +
        (proch ? 'Prochain jour : ' + esc(proch.libelle) + '.' : 'Tous les jours de cette session sont passés.') + '</div></div>';
    }
    if (s.ici < 0) return '<div class="panel der-now der-noprint"><div class="k">' + esc(s.jour.libelle) + '</div><div class="s">Journée terminée</div><div class="x">Pensez à clôturer l’émargement de l’après-midi.</div></div>';
    const x = s.liste[s.ici], suite = s.liste[s.ici + 1];
    return '<div class="panel der-now der-noprint"><div class="k">' + (s.avant ? 'À venir · ' : 'Maintenant · ') + esc(x.e[0]) + ' · ' + esc(x.dm.periode) + '</div>' +
      '<div class="s">' + esc(x.e[1]) + '</div>' + (x.e[2] ? '<div class="x">' + esc(x.e[2]) + '</div>' : '') +
      (suite ? '<div class="x" style="margin-top:6px"><b>Ensuite</b> · ' + esc(suite.e[0]) + ' · ' + esc(suite.e[1]) + '</div>' : '') +
      '<div class="row" style="margin-top:10px"><button type="button" id="derEmg">Émargement de cette demi-journée</button></div></div>';
  }

  function blocJours(g) {
    const s = situer(g), n = paris();
    const ouvert = s.jour ? s.jour.date : ((g.jours || []).find(x => x.date >= n.jour) || {}).date;
    return (g.jours || []).map(j => {
      const demi = (j.demi || []).map((dm, di) => {
        const et = (dm.etapes || []).map((e, ei) => {
          const ici = s.jour === j && s.ici >= 0 && s.liste[s.ici].di === di && s.liste[s.ici].ei === ei;
          if (e[1] === 'Pause') return '<div class="der-et pause' + (ici ? ' ici' : '') + '"><span class="h">' + esc(e[0]) + '</span><span>Pause</span></div>';
          return '<div class="der-et' + (ici ? ' ici' : '') + '"><span class="h">' + esc(e[0]) + '</span><span><span class="s">' + esc(e[1]) + '</span>' + (e[2] ? ' — ' + esc(e[2]) : '') + '</span>' +
            (e[3] ? '<span class="o">Outils / production : ' + esc(e[3]) + '</span>' : '') + '</div>';
        }).join('');
        const chips = (dm.obj || []).map(o => '<span class="der-chip">' + esc(o) + '</span>').join('');
        return '<div class="der-demi"><div class="p">' + esc(dm.periode) + '</div><h3>' + esc(dm.titre) + chips + '</h3><div class="i">' + esc(dm.intention) + '</div>' + et +
          '<div class="der-rv"><div><h4>Réponses attendues</h4>' + esc(dm.reponses) + '</div><div><h4>Points de vigilance</h4>' + esc(dm.vigilance) + '</div></div></div>';
      }).join('');
      return '<details class="der-jour panel"' + (j.date === ouvert ? ' open' : '') + '><summary>' + esc(j.libelle) + '</summary>' + demi + '</details>';
    }).join('');
  }

  function rendre() {
    if (!zone) return;
    if (!d || !d.moi) { zone.innerHTML = '<div class="panel muted">Connectez-vous avec votre compte de formateur pour lire le déroulé.</div>'; return; }
    if (d.refuse) { zone.innerHTML = '<div class="panel muted">Ce déroulé est réservé aux formateurs de la session.</div>'; return; }
    if (!d.guide) { zone.innerHTML = '<div class="panel muted">Pas encore de déroulé pour cette session. Claude l’importe à la demande d’Alexandre, une fois le guide validé.</div>'; return; }
    const g = d.guide.contenu || {};
    const liste = (titre, l, cls) => (l && l.length ? '<div class="panel ' + (cls || '') + '"><h3 style="margin-top:0">' + titre + '</h3><ul class="der-liste" style="margin:0;padding-left:18px">' + l.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '');
    zone.innerHTML = '<div id="der-guide" style="display:flex;flex-direction:column;gap:12px">' +
      blocMaintenant(g) +
      '<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3 style="margin:0">' + esc(g.titre) + '</h3>' +
        '<div class="muted small">' + esc(g.client) + ' · ' + esc(g.ville) + ' · guide version ' + esc(d.guide.version) + ' du ' + esc(d.guide.le) + (d.guide.valide_par ? ', validé par ' + esc(d.guide.valide_par) : '') + '</div></div>' +
        '<button type="button" id="derPrint" class="der-noprint">Imprimer</button></div>' +
        '<div class="der-kv" style="margin-top:10px"><b>Dates</b><span>' + esc(g.dates) + '</span><b>Horaires</b><span>' + esc(g.horaires) + '</span><b>Durée</b><span>' + esc(g.duree) + '</span><b>Lieu</b><span>' + esc(g.lieu) + '</span><b>Formateurs</b><span>' + esc(g.formateurs) + '</span><b>Public</b><span>' + esc(g.public) + '</span></div>' +
        (g.statut ? '<p class="small" style="margin:10px 0 0"><b>' + esc(g.statut) + '</b></p>' : '') + '</div>' +
      '<div class="panel der-obj"><h3 style="margin-top:0">Objectifs du programme envoyé</h3>' + (g.objectifs || []).map(o => '<div><span class="der-c">' + esc(o[0]) + '</span>' + esc(o[1]) + '</div>').join('') + '</div>' +
      liste('À régler avant / pendant la session', g.alertes, 'der-alerte') +
      (g.materiel ? '<div class="panel"><h3 style="margin-top:0">Matériel</h3><div style="font-size:14px">' + esc(g.materiel) + '</div></div>' : '') +
      blocJours(g) +
      liste('Après la session', g.apres) + liste('Références', g.references) + liste('Établi à partir de', g.sources) +
      '<p class="muted small">Document interne aux formateurs : réponses attendues et consignes de jeu, à ne pas transmettre tel quel. Tous les cas sont fictifs.</p></div>';
    const b = $('derEmg'); if (b) b.onclick = () => { const t = document.querySelector('#f_tabs [data-ft-go="emarg"]'); if (t) t.click(); };
    $('derPrint').onclick = imprimer;
  }

  function imprimer() {
    const det = zone ? [...zone.querySelectorAll('details.der-jour')] : [], avant = det.map(x => x.open);
    det.forEach(x => x.open = true); document.body.classList.add('der-imprime');
    const fin = () => { document.body.classList.remove('der-imprime'); det.forEach((x, i) => x.open = avant[i]); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin); window.print(); setTimeout(fin, 60000);
  }

  async function afficher() {
    if (!zone) return;
    try { const { data, error } = await sb.rpc('gui_deroule', { p_code: code }); if (error) throw error; d = data; }
    catch (e) { zone.innerHTML = '<div class="panel muted">' + esc(msgErr(e)) + '</div>'; return; }
    rendre();
  }

  // le bandeau « Maintenant » se met à jour chaque minute sans relire la base
  function rafraichir() { if (zone && d && d.guide && !document.body.classList.contains('der-imprime')) { const ouverts = [...zone.querySelectorAll('details.der-jour')].map(x => x.open), y = window.scrollY; rendre(); zone.querySelectorAll('details.der-jour').forEach((x, i) => { if (i in ouverts) x.open = ouverts[i]; }); window.scrollTo(0, y); } }

  function monter(el, c) {
    if (!sb || !el) return;
    if (code !== c) d = null; zone = el; code = c;
    zone.innerHTML = '<div class="panel muted">Chargement…</div>';
    if (minuteur) clearInterval(minuteur); minuteur = setInterval(rafraichir, 60000);
    afficher();
  }
  function quitter() { zone = null; if (minuteur) { clearInterval(minuteur); minuteur = null; } }
  function init(o) { sb = o.sb; toast = o.toast; esc = o.esc; $ = o.$; }
  return { init, monter, quitter };
})();
