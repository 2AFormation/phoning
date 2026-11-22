// 2A Formation – affichage d'un questionnaire de bilan (positionnement, à chaud, auto-évaluation).
// Partagé par la page des stagiaires (bilan.html) et l'appli des formateurs (bilans.js : saisie papier,
// auto-évaluation). Les questions viennent du modèle enregistré dans la base (repris mot pour mot du Word).
// QUEST.rendre(conteneur, contenuDuModele, objectifs, options) → { lire(), sections, montrer(i), nbSections }
'use strict';
var QUEST = (function () {
  var css = document.createElement('style');
  css.textContent =
    '.qz{display:flex;flex-direction:column;gap:18px}' +
    '.qz-sec{display:flex;flex-direction:column;gap:16px}' +
    '.qz-sec[hidden]{display:none}' +
    '.qz-titre{font-size:19px;font-weight:700;margin:0;display:flex;gap:10px;align-items:baseline}' +
    '.qz-titre .n{color:#B8572A;font-weight:800}' +
    '.qz-aide{color:#4F5D59;font-size:15px;margin:0}' +
    '.qz-q{background:#fff;border:1px solid #C9D3CF;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.qz-q[hidden]{display:none}' +
    '.qz-lib{font-weight:600;font-size:16.5px;line-height:1.35}' +
    '.qz-ops{display:flex;flex-wrap:wrap;gap:8px}' +
    '.qz-ops.col{flex-direction:column}' +
    '.qz-op{position:relative;display:flex}' +
    '.qz-op input{position:absolute;opacity:0;width:1px;height:1px}' +
    '.qz-op span{display:flex;align-items:center;justify-content:center;min-height:46px;min-width:46px;padding:8px 14px;border:2px solid #C9D3CF;border-radius:12px;background:#fff;font-size:16px;line-height:1.25;cursor:pointer;color:#1C2B27;text-align:center}' +
    '.qz-ops.col .qz-op span{justify-content:flex-start;text-align:left;width:100%}' +
    '.qz-ops.col .qz-op{width:100%}' +
    '.qz-op input:checked+span{background:#2E5B4E;border-color:#2E5B4E;color:#fff;font-weight:700}' +
    '.qz-op input:focus-visible+span{outline:3px solid #E08A1E;outline-offset:2px}' +
    '.qz-ech{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}' +
    '.qz-ech .qz-op span{width:100%;font-weight:700;font-size:18px}' +
    '.qz-legende{display:flex;justify-content:space-between;font-size:13px;color:#4F5D59}' +
    '.qz-obj{border-top:1px solid #E4EEEA;padding-top:10px;display:flex;flex-direction:column;gap:8px}' +
    '.qz-obj:first-of-type{border-top:0;padding-top:0}' +
    '.qz-obj .ob{font-size:15.5px;line-height:1.35}' +
    '.qz-q textarea,.qz-q input[type=text],.qz-q input[type=email]{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:2px solid #C9D3CF;border-radius:12px;background:#fff;color:#1C2B27}' +
    '.qz-q textarea{min-height:90px;resize:vertical}' +
    '.qz-petit{font-size:13.5px;color:#4F5D59}';
  document.head.appendChild(css);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  var uid = 0;

  function radio(nom, valeur, texte, coche) {
    return '<label class="qz-op"><input type="radio" name="' + nom + '" value="' + esc(valeur) + '"' + (coche ? ' checked' : '') + '><span>' + esc(texte) + '</span></label>';
  }
  function caseMulti(nom, valeur, coche) {
    return '<label class="qz-op"><input type="checkbox" name="' + nom + '" value="' + esc(valeur) + '"' + (coche ? ' checked' : '') + '><span>' + esc(valeur) + '</span></label>';
  }

  function question(q, objectifs, v, pref) {
    var n = pref + q.id, h = '', val = v[q.id];
    var attrs = ' data-q="' + esc(q.id) + '" data-type="' + q.type + '"' + (q.si ? ' data-si="' + esc(q.si.q) + '" data-si-v="' + esc(JSON.stringify(q.si.valeurs)) + '"' : '');
    h += '<div class="qz-q"' + attrs + '>';
    if (q.type !== 'objectifs' || q.libelle) h += '<div class="qz-lib" id="' + n + '_l">' + esc(q.libelle) + '</div>';
    if (q.aide) h += '<div class="qz-petit">' + esc(q.aide) + '</div>';
    if (q.type === 'objectifs') {
      objectifs.forEach(function (o, i) {
        var cur = val && val[i];
        h += '<div class="qz-obj" role="radiogroup" aria-label="' + esc(o) + '"><div class="ob">' + esc(o) + '</div><div class="qz-ops col">' +
          q.echelle.map(function (e, k) { return radio(n + '_' + i, k + 1, e, cur === k + 1); }).join('') + '</div></div>';
      });
    } else if (q.type === 'echelle') {
      h += '<div class="qz-ech" role="radiogroup" aria-labelledby="' + n + '_l">';
      for (var k = (q.min || 1); k <= (q.max || 5); k++) h += radio(n, k, String(k), val === k);
      h += '</div><div class="qz-legende"><span>pas du tout satisfait</span><span>tout à fait satisfait</span></div>';
    } else if (q.type === 'choix') {
      var col = q.options.some(function (o) { return o.length > 14; });
      h += '<div class="qz-ops' + (col ? ' col' : '') + '" role="radiogroup" aria-labelledby="' + n + '_l">' + q.options.map(function (o) { return radio(n, o, o, val === o); }).join('') + '</div>';
      if (q.commentaire) h += '<input type="text" maxlength="500" data-com="' + esc(q.id) + '" placeholder="Commentaire (facultatif)" value="' + esc(v[q.id + '_com'] || '') + '">';
    } else if (q.type === 'multi') {
      h += '<div class="qz-ops col">' + q.options.map(function (o) { return caseMulti(n, o, (val || []).indexOf(o) >= 0); }).join('') + '</div>';
      if (q.autre) h += '<input type="text" maxlength="500" data-autre="' + esc(q.id) + '" placeholder="Autre : …" value="' + esc(v[q.id + '_autre'] || '') + '">';
    } else if (q.type === 'texte') {
      h += q.court
        ? '<input type="text" maxlength="' + (q.max || 100) + '" data-txt="' + esc(q.id) + '" aria-labelledby="' + n + '_l" value="' + esc(val || '') + '">'
        : '<textarea maxlength="' + (q.max || 2000) + '" data-txt="' + esc(q.id) + '" aria-labelledby="' + n + '_l">' + esc(val || '') + '</textarea>';
    }
    return h + '</div>';
  }

  function rendre(cont, modele, objectifs, opt) {
    opt = opt || {}; var v = opt.valeurs || {}; var pref = 'qz' + (++uid) + '_';
    var secs = modele.sections || [];
    cont.innerHTML = '<div class="qz">' + secs.map(function (s, i) {
      return '<section class="qz-sec" data-sec="' + i + '"><h2 class="qz-titre"><span class="n">' + (i + 1) + '</span>' + esc(s.titre) + '</h2>' +
        (s.aide ? '<p class="qz-aide">' + esc(s.aide) + '</p>' : '') +
        s.questions.map(function (q) { return question(q, objectifs, v, pref); }).join('') + '</section>';
    }).join('') + '</div>';
    var racine = cont.querySelector('.qz');
    function majConditions() {
      racine.querySelectorAll('[data-si]').forEach(function (b) {
        var src = racine.querySelector('[data-q="' + b.getAttribute('data-si') + '"] input:checked');
        var vals = JSON.parse(b.getAttribute('data-si-v'));
        b.hidden = !(src && vals.indexOf(src.value) >= 0);
      });
    }
    racine.addEventListener('change', majConditions); majConditions();

    function lire() {
      var r = {};
      secs.forEach(function (s) { s.questions.forEach(function (q) {
        var b = racine.querySelector('[data-q="' + q.id + '"]'); if (!b || b.hidden) return;
        var n = pref + q.id;
        if (q.type === 'objectifs') {
          var t = objectifs.map(function (_, i) { var c = b.querySelector('input[name="' + n + '_' + i + '"]:checked'); return c ? +c.value : null; });
          if (t.some(function (x) { return x !== null; })) r[q.id] = t;
        } else if (q.type === 'echelle') {
          var c = b.querySelector('input[name="' + n + '"]:checked'); if (c) r[q.id] = +c.value;
        } else if (q.type === 'choix') {
          var c2 = b.querySelector('input[name="' + n + '"]:checked'); if (c2) r[q.id] = c2.value;
          var com = b.querySelector('[data-com]'); if (com && com.value.trim()) r[q.id + '_com'] = com.value.trim();
        } else if (q.type === 'multi') {
          var l = Array.prototype.map.call(b.querySelectorAll('input[name="' + n + '"]:checked'), function (x) { return x.value; });
          if (l.length) r[q.id] = l;
          var au = b.querySelector('[data-autre]'); if (au && au.value.trim()) r[q.id + '_autre'] = au.value.trim();
        } else if (q.type === 'texte') {
          var tx = b.querySelector('[data-txt]'); if (tx && tx.value.trim()) r[q.id] = tx.value.trim();
        }
      }); });
      return r;
    }
    function montrer(i) { racine.querySelectorAll('.qz-sec').forEach(function (s) { s.hidden = +s.getAttribute('data-sec') !== i; }); }
    if (opt.pagine) montrer(0);
    return { lire: lire, montrer: montrer, nbSections: secs.length, racine: racine };
  }

  // Lecture d'une réponse enregistrée, pour l'affichage des résultats
  function libelles(modele) {
    var m = {}; (modele.sections || []).forEach(function (s) { s.questions.forEach(function (q) { m[q.id] = q; }); }); return m;
  }
  return { rendre: rendre, libelles: libelles, esc: esc };
})();
