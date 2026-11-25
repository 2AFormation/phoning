// PDF « Bilan à froid » (A4 portrait), environ trois mois après la formation :
// taux de réponse (indicateur 30), objectifs avec le recul comparés au début et à la fin de la formation (indicateur 11),
// mise en pratique et appréciation des stagiaires, regard de l'établissement (indicateur 30),
// points à reporter au plan d'amélioration (indicateur 32).
// Le contexte (bil_srv_froid_contexte) ne contient aucune adresse : le PDF n'en contient donc aucune.
// Les questions sont lues dans les modèles versionnés (froid_stagiaire_v1, froid_responsable_v1) : une nouvelle version
// de questionnaire s'affiche sans changer ce fichier ; seuls les seuils du point 6 visent des questions précises.
import { Ctx, Doc, GRIS, H, M, moy, nf, NOIR, OCRE, VERT, W } from "./pdf.ts";

const pct = (a: number, b: number) => b ? Math.round(100 * a / b) + " %" : "–";
const vide = (x: unknown) => x === undefined || x === null || x === "" || (Array.isArray(x) && !x.length);
// Écart arrondi au dixième, signe toujours écrit (le signe moins typographique n'existe pas dans la police du PDF).
// L'arrondi porte sur la valeur absolue (comme nf) : -2,25 donne -2,3, comme la ligne du plan d'amélioration (v5).
const dixieme = (x: number) => Math.round(Math.abs(x) * 10) / 10;
function ecart(a: number | null, b: number | null): string {
  if (a == null || b == null) return "–";
  const e = dixieme(a - b);
  return e === 0 ? "0" : (a - b > 0 ? "+" : "-") + String(e).replace(".", ",");
}
// Statut de remise de l'établissement : code enregistré par envois-brevo, écrit en clair dans le PDF (v5)
const REMISE: Record<string, string> = { delivre: "délivré", rejete: "rejeté", en_cours: "en cours", inconnu: "inconnu" };
function compter(l: Ctx[], id: string): Record<string, number> {
  const n: Record<string, number> = {};
  l.forEach((r: Ctx) => ([] as unknown[]).concat(r.contenu[id] ?? []).forEach((x) => { if (!vide(x)) n[String(x)] = (n[String(x)] || 0) + 1; }));
  return n;
}
const somme = (n: Record<string, number>, cles: string[]) => cles.reduce((a, k) => a + (n[k] || 0), 0);

export async function pdfFroid(ctx: Ctx, logo: Uint8Array, version: number, integrite: string): Promise<Uint8Array> {
  const d = new Doc(ctx); await d.init(logo, "Bilan à froid");
  const s = ctx.session, O: string[] = s.objectifs || [], N = (ctx.stagiaires || []).length, fr = ctx.froid || {};
  const camp = (t: string) => (ctx.campagnes || []).find((c: Ctx) => c.type === t);
  const reps = (c: Ctx) => c ? (ctx.reponses || []).filter((r: Ctx) => r.campagne === c.id) : [];
  const P = camp("positionnement"), CH = camp("chaud"), FS = camp("froid_stagiaire"), FR = camp("froid_responsable");
  const lp = reps(P), lc = reps(CH), lf = reps(FS), le = reps(FR);
  const mod = (c: Ctx) => c && ctx.modeles[c.modele_id] ? ctx.modeles[c.modele_id].contenu : { sections: [] };
  const qs = (m: Ctx) => (m.sections || []).flatMap((x: Ctx) => x.questions || []);
  const question = (c: Ctx, id: string) => qs(mod(c)).find((x: Ctx) => x.id === id);
  const papier = (l: Ctx[]) => l.filter((r: Ctx) => r.mode === "papier").length;
  const valeurs = (l: Ctx[], id: string) => l.map((r: Ctx) => r.contenu[id]).filter((x: Ctx) => !vide(x));
  const obj = (l: Ctx[], i: number) => l.map((r: Ctx) => (r.contenu.obj || [])[i]).filter((x: Ctx) => x) as number[];
  const ameliorer: string[] = [];

  // Choix et choix multiples : une ligne de comptes par question (+ « Autre » précisé)
  const comptes = (q: Ctx, l: Ctx[]) => {
    const n = compter(l, q.id);
    d.place(26); d.para(q.libelle, 9.5, d.fb);
    d.para((q.options || []).map((o: string) => `${o} : ${n[o] || 0}`).join("    "), 9.5);
    const autres = valeurs(l, q.id + "_autre");
    if (autres.length) d.para("Autres : " + autres.join(" ; "), 9);
    d.y -= 3;
    return n;
  };
  const verbatims = (q: Ctx, l: Ctx[]) => {
    const v = valeurs(l, q.id);
    if (!v.length) return false;
    d.place(30); d.para(q.libelle, 9.5, d.fb);
    v.forEach((x: string) => d.para("– " + x, 9, d.f, NOIR, M + 8, W - 2 * M - 8));
    d.y -= 4;
    return true;
  };

  // En-tête
  d.txt("BILAN À FROID", M + d.lw + 14, H - M - 18, 17, d.fb, VERT);
  d.txt("Environ trois mois après la formation · version " + version + (s.fictive ? " – SESSION FICTIVE (test)" : ""), M + d.lw + 14, H - M - 34, 9.5, d.f, s.fictive ? OCRE : GRIS);
  d.y -= 4;
  d.para(s.intitule, 13, d.fb);
  const envoi = fr.envoye_le
    ? `le ${fr.envoye_le} : ${fr.envoyes || 0} mail(s) aux stagiaires` + (fr.m3_envoye_le ? `, établissement le ${fr.m3_envoye_le}` : ", établissement non joint")
    : "non envoyé";
  const fermes = [FS && FS.fermee_le ? "stagiaires le " + FS.fermee_le : "", FR && FR.fermee_le ? "établissement le " + FR.fermee_le : ""].filter(Boolean).join(", ");
  const champs: [string, string][] = [["Dates", s.dates], ["Durée", s.duree], ["Lieu", s.lieu], ["Formateurs", (ctx.formateurs || []).map((f: Ctx) => f.nom).join(", ")],
    ["Code de session", s.code], ["Envoi à froid", envoi], ["Date limite", fr.date_limite || "–"], ["Clôture", fermes || "–"]];
  for (const [k, v] of champs) { d.place(14); d.txt(k + " :", M, d.y - 10, 9.5, d.fb); d.txt(v, M + 95, d.y - 10, 9.5, d.f, NOIR, W - 2 * M - 95); d.y -= 14; }

  // 1. Taux de réponse
  d.titre("1", "Taux de réponse (indicateur 30)");
  d.tableau(["Questionnaire", "Réponses", "Taux", "Détail"], [170, 62, 48, W - 2 * M - 280], [
    ["Fin de formation (à chaud), pour repère", `${lc.length} / ${N}`, pct(lc.length, N), `${papier(lc)} saisi(s) depuis le papier`],
    ["À froid – stagiaires", `${lf.length} / ${N}`, pct(lf.length, N),
      `${fr.envoyes || 0} mail(s) envoyé(s) aux adresses laissées volontairement ; ` + (fr.m3_envoye_le ? "lien aussi transmis à l’établissement ; " : "") + `${papier(lf)} saisi(s) depuis le papier`],
    ["À froid – établissement", String(le.length), le.length ? "reçu" : "aucune",
      (fr.m3_envoye_le ? `questionnaire envoyé le ${fr.m3_envoye_le} à l’interlocuteur de l’établissement` : "questionnaire non envoyé") + ` ; ${papier(le)} saisi(s) depuis le papier`],
  ]);
  d.para(`Taux calculé sur les ${N} stagiaires de la liste d’émargement. Le lien des stagiaires est commun à la session (aucun lien personnel) : une personne peut répondre sans avoir laissé d’adresse, et aucune réponse ne peut être rattachée à une personne.`, 8.5, d.f, GRIS);
  if (fr.remise && typeof fr.remise === "object") {
    const r = fr.remise, parts: string[] = [];
    if (r.delivre !== undefined) parts.push(`${r.delivre} délivré(s)`);
    if (r.rejete !== undefined) parts.push(`${r.rejete} rejeté(s)`);
    if (r.en_cours !== undefined) parts.push(`${r.en_cours} en cours`);
    if (r.inconnu !== undefined) parts.push(`${r.inconnu} sans statut`);
    if (parts.length || r.etablissement !== undefined)
      d.para("Remise relevée auprès de Brevo – mails aux stagiaires : " + (parts.join(", ") || "–") + (r.etablissement !== undefined ? ` ; établissement : ${REMISE[String(r.etablissement)] || r.etablissement}` : "") + ".", 8.5, d.f, GRIS);
  }
  if (fr.restantes) d.para(`${fr.restantes} adresse(s) en échec au dernier envoi : aucun mail reçu par ces personnes.`, 8.5, d.f, GRIS);
  if (N && lf.length / N < 0.3) ameliorer.push(`Taux de réponse des stagiaires à froid : ${pct(lf.length, N)} (moins de 30 %)`);
  if (!lf.length && !le.length) d.para("Aucune réponse reçue : ce bilan ne garde que la trace de l’envoi.", 9.5, d.fb);

  // 2. Objectifs avec le recul
  d.titre("2", "Atteinte des objectifs avec le recul (indicateur 11)");
  d.para("Autopositionnement des stagiaires : « Je me sens capable de… », de 1 (pas du tout) à 4 (tout à fait). Moyennes du groupe à chaque moment. Les réponses étant anonymes, les groupes ne sont pas forcément composés des mêmes personnes : la comparaison est collective, pas individuelle.", 9, d.f, GRIS);
  d.y -= 2;
  d.tableau(["Objectif", "Début", "Fin", "À froid", "Écart fin / froid", "À froid : 3 ou 4"], [190, 44, 44, 50, 78, W - 2 * M - 406], O.map((o, i) => {
    const a = obj(lp, i), b = obj(lc, i), c = obj(lf, i), ma = moy(a), mb = moy(b), mc = moy(c), hauts = c.filter((x) => x >= 3).length;
    const bas = mc != null && mc < 3, baisse = mb != null && mc != null && mc - mb <= -0.5;
    if (bas || baisse) ameliorer.push(`Objectif « ${o} » : ${nf(mc)} / 4 à froid` + (baisse ? `, en baisse de ${nf(dixieme(mc! - mb!))} ${dixieme(mc! - mb!) >= 2 ? "points" : "point"} depuis la fin de formation (${nf(mb)})` : ""));
    return [o, nf(ma), nf(mb), nf(mc), ecart(mc, mb), c.length ? `${pct(hauts, c.length)} (${hauts}/${c.length})` : "–"];
  }));
  d.para(`Nombre de réponses : début ${lp.length}, fin ${lc.length}, à froid ${lf.length}.` + (lf.length && lf.length < 5 ? " Moins de 5 réponses à froid : résultats à lire avec prudence." : ""), 8.5, d.f, GRIS);

  // 3. Stagiaires : mise en pratique et appréciation
  d.titre("3", "Mise en pratique et appréciation des stagiaires (indicateur 30)");
  if (!lf.length) d.para("Aucune réponse des stagiaires.", 9.5);
  else {
    for (const q of qs(mod(FS))) {
      if (q.type === "echelle") {
        const v = valeurs(lf, q.id) as number[], m = moy(v);
        d.barre(q.libelle, m, q.max || 5, v.length, q.min || 1);
        if (m != null && m < 3.5) ameliorer.push(`Stagiaires, « ${q.libelle} » : ${nf(m)} / ${q.max || 5}`);
      } else if (q.type === "choix" || q.type === "multi") {
        const n = comptes(q, lf);
        if (q.id === "q1" && somme(n, ["Rarement", "Jamais"])) ameliorer.push(`${somme(n, ["Rarement", "Jamais"])} stagiaire(s) utilisent rarement ou jamais ce qu’ils ont appris`);
        if (q.id === "q4") {
          const freins = Object.entries(n).filter(([k]) => k !== "Rien, je peux appliquer").map(([k, x]) => `${k} (${x})`);
          const autres = valeurs(lf, "q4_autre").length;
          if (freins.length || autres) ameliorer.push("Freins à la mise en pratique cités : " + [...freins, ...(autres ? [`autre (${autres})`] : [])].join(", "));
        }
        if (q.id === "q6" && somme(n, ["Peu utile", "Pas utile"])) ameliorer.push(`${somme(n, ["Peu utile", "Pas utile"])} stagiaire(s) jugent la formation peu ou pas utile avec le recul`);
        if (q.id === "q7" && n["Non"]) ameliorer.push(`${n["Non"]} stagiaire(s) ne recommanderaient pas la formation avec le recul`);
      }
    }
    // Repères : mêmes questions posées à la fin de la formation
    const reperes: string[][] = [];
    const satC = question(CH, "q12"), satF = question(FS, "q5");
    if (satC && satF) {
      const a = valeurs(lc, "q12") as number[], b = valeurs(lf, "q5") as number[];
      reperes.push(["Satisfaction globale (sur 5)", `${nf(moy(a))} (n = ${a.length})`, `${nf(moy(b))} (n = ${b.length})`]);
    }
    const recC = question(CH, "q14"), recF = question(FS, "q7");
    if (recC && recF) {
      const a = compter(lc, "q14"), b = compter(lf, "q7"), na = Object.values(a).reduce((x, y) => x + y, 0), nb = Object.values(b).reduce((x, y) => x + y, 0);
      reperes.push(["Recommanderaient la formation (« Oui »)", na ? `${pct(a["Oui"] || 0, na)} (${a["Oui"] || 0}/${na})` : "–",
        nb ? `${pct(b["Oui"] || 0, nb)} (${b["Oui"] || 0}/${nb})` + (b["Peut-être"] ? `, « Peut-être » : ${b["Peut-être"]}` : "") : "–"]);
    }
    if (reperes.length) {
      d.place(40); d.para("Repères : les mêmes questions à la fin de la formation", 9.5, d.fb);
      d.tableau(["Question", "Fin de formation", "À froid"], [211, 130, W - 2 * M - 341], reperes);
    }
  }

  // 4. Avec leurs mots
  d.titre("4", "Avec leurs mots (stagiaires)");
  let textes = false;
  for (const q of qs(mod(FS)).filter((x: Ctx) => x.type === "texte" && !["nom", "fonction"].includes(x.id))) textes = verbatims(q, lf) || textes;
  if (!textes) d.para("Aucune réponse écrite.", 9.5);
  const noms = lf.map((r: Ctx) => [r.contenu.nom, r.contenu.fonction].filter(Boolean).join(", ")).filter(Boolean);
  if (noms.length) d.para("Noms ou fonctions laissés volontairement : " + noms.join(" ; "), 8.5, d.f, GRIS);

  // 5. Établissement
  d.titre("5", "Regard de l’établissement (indicateur 30)");
  if (!le.length) d.para("Aucune réponse de l’établissement.", 9.5);
  else {
    for (const q of qs(mod(FR))) {
      if (q.type === "echelle") {
        const v = valeurs(le, q.id) as number[], m = moy(v);
        d.barre(q.libelle, m, q.max || 5, v.length, q.min || 1);
        if (m != null && m < 3.5) ameliorer.push(`Établissement, « ${q.libelle} » : ${nf(m)} / ${q.max || 5}`);
      } else if (q.type === "choix" || q.type === "multi") {
        const n = comptes(q, le);
        if (["q1", "q2", "q3", "q4"].includes(q.id) && n["Non"]) ameliorer.push(`Établissement, « ${q.libelle} » : Non (${n["Non"]})`);
        if (q.id === "q6" && somme(n, ["Partiellement", "Non"])) ameliorer.push(`Établissement : besoin de départ couvert partiellement ou non (${somme(n, ["Partiellement", "Non"])})`);
        if (q.id === "q7" && n["À améliorer"]) ameliorer.push(`Établissement : organisation à améliorer (${n["À améliorer"]})`);
        if (q.id === "q10" && n["Non"]) ameliorer.push(`Établissement : ne ferait pas de nouveau appel à 2A Formation (${n["Non"]})`);
      } else if (q.type === "texte" && q.id !== "repondant") verbatims(q, le);
    }
    const qui = valeurs(le, "repondant");
    if (qui.length) d.para("Personne(s) qui ont répondu : " + qui.join(" ; "), 8.5, d.f, GRIS);
  }

  // 6. Points à reporter
  d.titre("6", "Points à reporter au plan d’amélioration (indicateur 32)");
  if (ameliorer.length) ameliorer.forEach((a) => d.para("– " + a, 9.5));
  else d.para("Aucun point sous les seuils retenus (objectif inférieur à 3 sur 4 à froid ou en baisse d’au moins 0,5 depuis la fin de formation, moyenne inférieure à 3,5 sur 5, taux de réponse des stagiaires inférieur à 30 %, mise en pratique rare, freins cités, formation jugée peu utile ou non recommandée, réponses négatives de l’établissement).", 9.5);
  d.para("À relire : les besoins de formation exprimés (question 8 des stagiaires, question 9 de l’établissement) et les remarques libres sont aussi à reporter au plan d’amélioration.", 8.5, d.f, GRIS);
  d.y -= 6;
  d.para(integrite, 8.5, d.f, GRIS);

  d.pied("bilan à froid – version " + version);
  return await d.doc.save({ useObjectStreams: false });
}
