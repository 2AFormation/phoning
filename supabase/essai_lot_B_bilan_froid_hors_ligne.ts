// Essai hors ligne de bilans-pdf v5 (étape 3 du lot B, corrections du 23/11/2026 après le test fictif) : aucune base, aucun envoi, données fictives seulement.
// deno run --allow-read --allow-write --allow-run --allow-env essai_lot_B_bilan_froid_hors_ligne.ts <dossier de la fonction> <dossier de sortie> [<pdf.ts v3>]
// (pdftotext nécessaire ; le dossier de la fonction est supabase/functions/bilans-pdf)
// 1. Bilan à froid : cas complet, cas sans aucune réponse, cas avec seuils franchis ; aucune adresse dans le PDF.
// 2. Bilan de la formation : rendu identique avant et après la v4 (si l'ancien pdf.ts est donné).
const [dossier, sortie, ancien] = Deno.args;
const { pdfFroid } = await import(new URL("froid.ts", "file://" + dossier + "/").href);
const { pdfBilan } = await import(new URL("pdf.ts", "file://" + dossier + "/").href);
const { LOGO_JPG } = await import(new URL("ressources.ts", "file://" + dossier + "/").href);
const LOGO = Uint8Array.from(atob(LOGO_JPG), (c) => c.charCodeAt(0));

let ok = 0, ko = 0;
const verif = (c: boolean, m: string) => { if (c) ok++; else { ko++; console.log("ÉCHEC : " + m); } };

// Modèles : relus dans les scripts 26 et 37 (dossier supabase, deux niveaux au-dessus de la fonction), mot pour mot
const modeles: Record<string, unknown> = {};
for (const f of ["26_bilans_modeles.sql", "37_froid_modeles.sql"]) {
  const re = /insert into bilans\.modeles \(id, type, version, titre, contenu\) values \('([^']+)', '([^']+)', \d+, '((?:[^']|'')*)', '((?:[^']|'')*)'::jsonb\)/g;
  for (const m of Deno.readTextFileSync(dossier + "/../../" + f).matchAll(re))
    modeles[m[1]] = { titre: m[3].replaceAll("''", "'"), type: m[2], contenu: JSON.parse(m[4].replaceAll("''", "'")) };
}
verif(["positionnement_v1", "chaud_v2", "froid_stagiaire_v1", "froid_responsable_v1"].every((k) => k in modeles), "modèles relus dans 26 et 37");
const O = ["Objectif fictif A : repérer les étapes d’une démarche", "Objectif fictif B : rédiger un écrit professionnel structuré", "Objectif fictif C : situer son action dans le cadre légal"];
const stagiaires = Array.from({ length: 10 }, (_, i) => ({ id: crypto.randomUUID(), nom: `Stagiaire Fictif ${i + 1}`, ajoute_sur_place: false }));
const camp = (type: string, modele_id: string) => ({ id: crypto.randomUUID(), type, etat: "fermee", modele_id, fermee_le: "10/03/2027 à 18:00" });
const P = camp("positionnement", "positionnement_v1"), CH = camp("chaud", "chaud_v2"), FS = camp("froid_stagiaire", "froid_stagiaire_v1"), FR = camp("froid_responsable", "froid_responsable_v1");
const rep = (c: { id: string }, contenu: unknown, mode = "telephone") => ({ campagne: c.id, stagiaire_id: null, mode, contenu });

function ctxDe(reponses: unknown[], extra: Record<string, unknown> = {}) {
  return {
    session: { id: crypto.randomUUID(), code: "TEST-FROID-HORS-LIGNE", intitule: "Formation fictive pour l’essai du bilan à froid", lieu: "Lieu fictif", fictive: true,
      dates: "1er, 2 et 3 décembre 2026", duree: "3 jours, 18 heures", objectifs: O, criteres: [{ titre: "Critère fictif", indicateurs: "indicateur fictif" }] },
    maintenant: "23/11/2026 à 02:00", formateurs: [{ cle: "alexandre", nom: "Alexandre Bigot", email: "2aa.formation+formateur@gmail.com" }],
    stagiaires, campagnes: [P, CH, FS, FR], modeles, reponses, validation: null, acquis: [], commentaires: {}, autoevaluations: [], contacts_froid: 0,
    version: 1, derniere: "0".repeat(64),
    froid: { date_limite: "24/03/2027", envoye_le: "03/03/2027", m3_envoye_le: "03/03/2027", essais: 1, envoyes: 6, restantes: 0,
      remise: { delivre: 5, rejete: 1, en_cours: 0, etablissement: "delivre" },   // code tel qu’enregistré par envois-brevo
      stagiaires: { ouverte_le: "03/03/2027", fermee_le: "24/03/2027" }, responsable: { ouverte_le: "03/03/2027", fermee_le: "24/03/2027" } },
    ...extra,
  };
}

const base = [
  ...Array.from({ length: 9 }, (_, i) => rep(P, { obj: [1 + (i % 2), 2, 1] })),
  ...Array.from({ length: 9 }, (_, i) => rep(CH, { obj: [4, 3 + (i % 2), 3], q12: 4 + (i % 2), q13: "Oui", q14: "Oui", q15: "Texte fictif à chaud" }, i === 0 ? "papier" : "telephone")),
];
const froidS = [
  rep(FS, { obj: [4, 3, 3], q1: "Souvent", q2: "Situation fictive décrite sans nom.", q3: ["Mes écrits et transmissions", "Ma posture professionnelle"], q4: ["Rien, je peux appliquer"], q5: 5, q6: "Très utile", q7: "Oui", q8: "Besoin fictif : approfondir l’écrit", nom: "", fonction: "Fonction fictive" }),
  rep(FS, { obj: [3, 2, null], q1: "Parfois", q3: ["Ma connaissance du cadre légal"], q3_autre: "Précision fictive", q4: ["Le manque de temps"], q5: 4, q6: "Utile", q7: "Peut-être", q9: "Remarque fictive" }),
  rep(FS, { obj: [4, 2, 2], q1: "Rarement", q4: ["Le manque de temps", "L’organisation du service"], q5: 3, q6: "Peu utile", q7: "Non" }, "papier"),
  rep(FS, { obj: [4, 4, 3], q1: "Très souvent", q5: 5, q6: "Très utile", q7: "Oui" }),
];
const froidR = [rep(FR, { q1: "Oui", q2: "Un peu", q3: "Non", q4: "Oui", q5: "Exemple fictif.", q6: "En grande partie", q7: "Satisfaisante", q8: 4, q9: "Besoin fictif de l’équipe", q10: "Oui", q11: "", repondant: "Fonction fictive de direction" })];

async function texte(pdf: Uint8Array) {
  const f = await Deno.makeTempFile({ suffix: ".pdf" }); Deno.writeFileSync(f, pdf);
  const o = await new Deno.Command("pdftotext", { args: ["-layout", f, "-"] }).output();
  return new TextDecoder().decode(o.stdout);
}

// 1a. cas complet
const p1 = await pdfFroid(ctxDe([...base, ...froidS, ...froidR]), LOGO, 1, "Contrôle d’intégrité fictif.");
Deno.writeFileSync(sortie + "/essai_bilan_froid_complet.pdf", p1);
const t1 = await texte(p1);
verif(t1.includes("BILAN À FROID"), "titre");
verif(t1.includes("SESSION FICTIVE"), "marque de session fictive");
verif(/4 \/ 10\s+40 %/.test(t1), "taux stagiaires 4/10 = 40 %");
verif(t1.includes("Écart fin / froid"), "colonne d’écart");
verif(/en baisse de 0,7 point/.test(t1) && (t1.match(/Objectif « Objectif fictif B/g) || []).length === 1, "baisse d’un objectif signalée, une seule ligne");
verif(t1.includes("ne recommanderaient pas"), "non-recommandation signalée");
verif(t1.includes("Freins à la mise en pratique cités"), "freins signalés");
verif(t1.includes("Repères"), "repères à chaud");
verif(t1.includes("Fonction fictive de direction"), "répondant établissement");
verif(t1.includes("5 délivré(s)"), "remise Brevo");
verif(!/@/.test(t1), "aucune adresse e-mail dans le PDF");
verif(t1.includes("Moins de 5 réponses"), "prudence sous 5 réponses");

// 1b. aucune réponse à froid
const p2 = await pdfFroid(ctxDe(base, { froid: { date_limite: "24/03/2027", envoye_le: "03/03/2027", m3_envoye_le: null, envoyes: 0, restantes: 2 } }), LOGO, 2, "Contrôle d’intégrité fictif.");
Deno.writeFileSync(sortie + "/essai_bilan_froid_sans_reponse.pdf", p2);
const t2 = await texte(p2);
verif(t2.includes("Aucune réponse reçue"), "cas sans réponse");
verif(t2.includes("questionnaire non envoyé"), "établissement non envoyé");
verif(t2.includes("2 adresse(s) en échec"), "adresses en échec");
verif(!t2.includes("lien aussi transmis"), "pas de lien transmis sans mail à l’établissement");
verif(t1.includes("lien aussi transmis"), "lien transmis avec mail à l’établissement");
verif(t2.includes("version 2"), "numéro de version");

verif(t1.includes("établissement : délivré") && !t1.includes("établissement : delivre"), "statut de l’établissement écrit en clair");

// 1c. cas du test fictif du 23/11/2026 : moyennes en demis (3,25 et 2,75), écarts -2,25 et -0,75
const P4 = [[1, 1, 1], [2, 2, 2], [2, 2, 2], [2, 2, 2]].map((o) => rep(P, { obj: o }));
const C4 = [[3, 3, 3], [3, 3, 3], [3, 3, 3], [4, 2, 2]].map((o) => rep(CH, { obj: o, q12: 4, q13: "Oui", q14: "Oui" }));
const p3 = await pdfFroid(ctxDe([...P4, ...C4, rep(FS, { obj: [1, 2, 2], q1: "Très souvent", q5: 3, q6: "Peu utile", q7: "Non" })],
  { stagiaires: stagiaires.slice(0, 4) }), LOGO, 1, "Contrôle d’intégrité fictif.");
Deno.writeFileSync(sortie + "/essai_bilan_froid_arrondis.pdf", p3);
const t3 = await texte(p3);
verif(/3,3\s+1\s+-2,3/.test(t3) && !t3.includes("-2,2"), "écart -2,25 écrit -2,3 dans le tableau");
verif(/2,8\s+2\s+-0,8/.test(t3) && !t3.includes("-0,7"), "écart -0,75 écrit -0,8 dans le tableau");
verif(t3.includes("en baisse de 2,3 points") && t3.includes("en baisse de 0,8 point "), "plan d’amélioration : mêmes valeurs que le tableau, « points » à partir de 2");

// 2. bilan de la formation inchangé (texte et nombre de pages identiques)
if (ancien) {
  const { pdfBilan: avant } = await import("file://" + ancien);
  const c = ctxDe(base); const a = await texte(await avant(c, LOGO, 3, "x")), b = await texte(await pdfBilan(c, LOGO, 3, "x"));
  verif(a === b && a.length > 500, "bilan de la formation identique avant et après la v4");
}
console.log(`${ok} vérification(s) réussie(s), ${ko} échec(s).`);
if (ko) Deno.exit(1);
