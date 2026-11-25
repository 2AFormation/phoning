// PDF « Bilan de la formation » (A4 portrait) : participation, progression sur les objectifs,
// satisfaction à chaud, verbatims, positionnement, appréciation des acquis, auto-évaluations, points à améliorer.
// v4 : outils exportés pour le « Bilan à froid » (froid.ts) ; rendu du bilan de la formation inchangé.
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export const W = 595.28, H = 841.89, M = 42, BAS = 52;
export const NOIR = rgb(0.11, 0.17, 0.15), GRIS = rgb(0.33, 0.37, 0.35), VERT = rgb(0.18, 0.36, 0.31), OCRE = rgb(0.72, 0.34, 0.16), FOND = rgb(0.86, 0.91, 0.89), LIGNE = rgb(0.79, 0.83, 0.81);
// deno-lint-ignore no-explicit-any
export type Ctx = any;

const cache = new Map<string, string>();
function propre(f: PDFFont, s: unknown): string {
  return Array.from(String(s ?? "").replace(/[\r\n\t]+/g, " ")).map((ch) => {
    const k = f.name + ch; if (cache.has(k)) return cache.get(k)!;
    let r = "?";
    for (const c of [ch, ch.normalize("NFD")[0], ch === "\u202f" || ch === "\u00a0" ? " " : ""]) { if (!c) continue; try { f.encodeText(c); r = c; break; } catch { /* suivant */ } }
    cache.set(k, r); return r;
  }).join("");
}
export function couper(f: PDFFont, t: number, s: string, max: number): string[] {
  const l: string[] = [];
  for (const para of String(s ?? "").split(/\n+/)) {
    const mots = propre(f, para).split(" "); let cur = "";
    for (const m of mots) { const e = cur ? cur + " " + m : m; if (f.widthOfTextAtSize(e, t) <= max || !cur) cur = e; else { l.push(cur); cur = m; } }
    if (cur) l.push(cur);
  }
  return l.length ? l : [""];
}
export const moy = (l: number[]) => l.length ? l.reduce((a, b) => a + b, 0) / l.length : null;
export const nf = (x: number | null) => x == null ? "–" : String(Math.round(x * 10) / 10).replace(".", ",");

export class Doc {
  doc!: PDFDocument; f!: PDFFont; fb!: PDFFont; logo!: PDFImage; page!: PDFPage; y = 0; lw = 0; pages: PDFPage[] = [];
  constructor(public ctx: Ctx) {}
  async init(logo: Uint8Array, titre = "Bilan de la formation") {
    this.doc = await PDFDocument.create();
    this.doc.setTitle(titre + " – " + this.ctx.session.code); this.doc.setAuthor("2A Formation"); this.doc.setCreator("2A Travail – bilans");
    this.f = await this.doc.embedFont(StandardFonts.Helvetica); this.fb = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.logo = await this.doc.embedJpg(logo);
    this.nouvelle(true);
  }
  nouvelle(premiere = false) {
    this.page = this.doc.addPage([W, H]); this.pages.push(this.page);
    const lh = premiere ? 42 : 24, lw = lh * this.logo.width / this.logo.height; if (premiere) this.lw = lw;
    this.page.drawImage(this.logo, { x: M, y: H - M - lh, width: lw, height: lh });
    if (!premiere) this.txt(this.ctx.session.intitule, M + lw + 10, H - M - 15, 8.5, this.f, GRIS, W - 2 * M - lw - 10);
    this.y = H - M - lh - (premiere ? 14 : 16);
  }
  place(h: number) { if (this.y - h < BAS) this.nouvelle(); }
  txt(s: string, x: number, y: number, t = 10, f?: PDFFont, c = NOIR, max?: number) {
    const ff = f || this.f; let tx = propre(ff, s);
    if (max) while (tx.length > 3 && ff.widthOfTextAtSize(tx, t) > max) tx = tx.slice(0, -2) + "…";
    this.page.drawText(tx, { x, y, size: t, font: ff, color: c });
  }
  para(s: string, t = 10, f?: PDFFont, c = NOIR, x = M, max = W - 2 * M, inter = 1.35) {
    for (const l of couper(f || this.f, t, s, max)) { this.place(t * inter); this.page.drawText(l, { x, y: this.y - t, size: t, font: f || this.f, color: c }); this.y -= t * inter; }
  }
  titre(n: string, s: string) {
    this.place(40); this.y -= 10;
    this.txt(n, M, this.y - 13, 13, this.fb, OCRE); this.txt(s, M + 20, this.y - 13, 13, this.fb, VERT);
    this.y -= 18; this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.6, color: LIGNE }); this.y -= 8;
  }
  barre(lib: string, v: number | null, max: number, n: number, mini = 1) {
    const t = 9.5, lw = 270, lignes = couper(this.f, t, lib, lw), h = Math.max(lignes.length * 12, 14) + 4;
    this.place(h);
    lignes.forEach((l, i) => this.page.drawText(l, { x: M, y: this.y - t - i * 12, size: t, font: this.f, color: NOIR }));
    const bx = M + lw + 12, bw = 150, by = this.y - 11;
    this.page.drawRectangle({ x: bx, y: by, width: bw, height: 8, color: FOND });
    if (v != null) this.page.drawRectangle({ x: bx, y: by, width: bw * (v - mini) / (max - mini), height: 8, color: VERT });
    this.txt(nf(v) + " / " + max, bx + bw + 8, this.y - t - 1, 9.5, this.fb);
    this.txt("n = " + n, bx + bw + 52, this.y - t - 1, 8, this.f, GRIS);
    this.y -= h;
  }
  tableau(entetes: string[], largeurs: number[], lignes: string[][], t = 8.5) {
    const ligne = (cells: string[], gras: boolean, fond?: boolean) => {
      const cs = cells.map((c, i) => couper(gras ? this.fb : this.f, t, c, largeurs[i] - 6));
      const h = Math.max(...cs.map((c) => c.length)) * (t + 2.5) + 6;
      this.place(h);
      let x = M;
      cs.forEach((c, i) => {
        if (fond) this.page.drawRectangle({ x, y: this.y - h, width: largeurs[i], height: h, color: FOND });
        this.page.drawRectangle({ x, y: this.y - h, width: largeurs[i], height: h, borderColor: LIGNE, borderWidth: 0.5 });
        c.forEach((l, k) => this.page.drawText(l, { x: x + 3, y: this.y - 3 - t - k * (t + 2.5), size: t, font: gras ? this.fb : this.f, color: NOIR }));
        x += largeurs[i];
      });
      this.y -= h;
    };
    ligne(entetes, true, true); lignes.forEach((l) => ligne(l, false));
    this.y -= 6;
  }
  pied(ref: string) {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      const l = `Bilans 2A Formation – ${this.ctx.session.code} – généré le ${this.ctx.maintenant} (heure du serveur) – ${ref} – page ${i + 1}/${n}`;
      p.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.5, color: LIGNE });
      p.drawText(propre(this.f, l), { x: M, y: 24, size: 7, font: this.f, color: GRIS });
      p.drawText(propre(this.f, "2A Formation – 2885 route de Saint-Papoul, 11400 Castelnaudary – SIRET 897 695 235 00019 – Déclaration d’activité n° 76 11 02023 11 – Certification Qualiopi"), { x: M, y: 15, size: 6.5, font: this.f, color: GRIS });
    });
  }
}

export async function pdfBilan(ctx: Ctx, logo: Uint8Array, version: number, integrite: string): Promise<Uint8Array> {
  const d = new Doc(ctx); await d.init(logo);
  const s = ctx.session, O: string[] = s.objectifs || [], C = s.criteres || [], N = (ctx.stagiaires || []).length;
  const camp = (t: string) => (ctx.campagnes || []).find((c: Ctx) => c.type === t);
  const reps = (c: Ctx) => c ? (ctx.reponses || []).filter((r: Ctx) => r.campagne === c.id) : [];
  const P = camp("positionnement"), CH = camp("chaud"), lp = reps(P), lc = reps(CH);
  const mod = (c: Ctx) => c ? ctx.modeles[c.modele_id].contenu : { sections: [] };
  const qs = (m: Ctx) => (m.sections || []).flatMap((x: Ctx) => x.questions);
  const nomSt: Record<string, string> = {}; (ctx.stagiaires || []).forEach((x: Ctx) => { nomSt[x.id] = x.nom; });

  // En-tête
  d.txt("BILAN DE LA FORMATION", M + d.lw + 14, H - M - 18, 17, d.fb, VERT);
  d.txt("Version " + version + (s.fictive ? " – SESSION FICTIVE (test)" : ""), M + d.lw + 14, H - M - 34, 9.5, d.f, s.fictive ? OCRE : GRIS);
  d.y -= 4;
  d.para(s.intitule, 13, d.fb);
  const champs: [string, string][] = [["Dates", s.dates], ["Durée", s.duree], ["Lieu", s.lieu], ["Formateurs", (ctx.formateurs || []).map((f: Ctx) => f.nom).join(", ")], ["Code de session", s.code]];
  for (const [k, v] of champs) { d.place(14); d.txt(k + " :", M, d.y - 10, 9.5, d.fb); d.txt(v, M + 95, d.y - 10, 9.5, d.f, NOIR, W - 2 * M - 95); d.y -= 14; }

  // 1. Participation
  d.titre("1", "Participation aux bilans");
  const autos = ctx.autoevaluations || [];
  d.tableau(["Bilan", "Réponses", "Détail"], [190, 80, 241], [
    ["Positionnement (avant la formation)", `${lp.length} / ${N}`, lp.filter((r: Ctx) => r.mode === "papier").length + " saisi(s) depuis le papier" + (P ? " – " + (P.etat === "fermee" ? "fermé le " + P.fermee_le : "non fermé") : "")],
    ["Évaluation à chaud (fin de formation)", `${lc.length} / ${N}`, lc.filter((r: Ctx) => r.mode === "papier").length + " saisi(s) depuis le papier" + (CH && CH.etat === "fermee" ? " – fermée le " + CH.fermee_le : "")],
    ["Appréciation des acquis (formateurs)", ctx.validation ? "validée" : "non validée", ctx.validation ? "le " + ctx.validation.le : "grille en cours"],
    ["Auto-évaluation des formateurs", `${autos.length} / ${(ctx.formateurs || []).length}`, autos.map((a: Ctx) => ((ctx.formateurs || []).find((f: Ctx) => f.cle === a.formateur) || { nom: a.formateur }).nom + " (" + a.le + ")").join(", ")],
    ["Adresses pour l’évaluation à froid", String(ctx.contacts_froid || 0), "laissées volontairement, conservées à part des réponses"],
  ]);

  // 2. Progression sur les objectifs
  d.titre("2", "Progression sur les objectifs du programme");
  d.para("Autopositionnement des stagiaires : « Je me sens capable de… », de 1 (pas du tout) à 4 (tout à fait). Moyennes du groupe.", 9, d.f, GRIS);
  d.y -= 2;
  d.tableau(["Objectif", "Début", "Fin", "Fin : « en grande partie » ou « tout à fait »"], [261, 55, 55, 140], O.map((o, i) => {
    const a = lp.map((r: Ctx) => (r.contenu.obj || [])[i]).filter((x: Ctx) => x), b = lc.map((r: Ctx) => (r.contenu.obj || [])[i]).filter((x: Ctx) => x);
    return [o, nf(moy(a)) + (a.length ? "" : ""), nf(moy(b)), b.length ? Math.round(100 * b.filter((x: number) => x >= 3).length / b.length) + " % (" + b.filter((x: number) => x >= 3).length + "/" + b.length + ")" : "–"];
  }));

  // 3. Satisfaction à chaud
  const ameliorer: string[] = [];
  if (CH) {
    d.titre("3", "Appréciation de la formation (évaluation à chaud)");
    for (const q of qs(mod(CH))) {
      const v = lc.map((r: Ctx) => r.contenu[q.id]).filter((x: Ctx) => x !== undefined && x !== null && x !== "");
      if (q.type === "echelle") { const m = moy(v); d.barre(q.libelle, m, 5, v.length); if (m != null && m < 3.5) ameliorer.push(`Question « ${q.libelle} » : ${nf(m)} / 5`); }
      else if (q.type === "choix") {
        const n: Record<string, number> = {}; v.forEach((x: string) => { n[x] = (n[x] || 0) + 1; });
        d.place(26); d.para(q.libelle, 9.5, d.fb); d.para(q.options.map((o: string) => `${o} : ${n[o] || 0}`).join("    "), 9.5);
        if (q.id === "q18" && n["Non"]) ameliorer.push(`${n["Non"]} stagiaire(s) estiment que leurs besoins particuliers n’ont pas été pris en compte`);
        if (q.id === "q13" && n["Non"]) ameliorer.push(`${n["Non"]} stagiaire(s) ne pensent pas pouvoir appliquer les acquis`);
        if (q.id === "q14" && n["Non"]) ameliorer.push(`${n["Non"]} stagiaire(s) ne recommanderaient pas la formation`);
        d.y -= 3;
      }
    }
    const textes = qs(mod(CH)).filter((q: Ctx) => q.type === "texte" && !["nom", "fonction"].includes(q.id));
    d.titre("4", "Avec leurs mots");
    for (const q of textes) {
      const v = lc.map((r: Ctx) => r.contenu[q.id]).filter((x: Ctx) => x);
      if (!v.length) continue;
      d.place(30); d.para(q.libelle, 9.5, d.fb);
      v.forEach((x: string) => d.para("– " + x, 9, d.f, NOIR, M + 8, W - 2 * M - 8));
      d.y -= 4;
    }
    const noms = lc.map((r: Ctx) => [r.contenu.nom, r.contenu.fonction].filter(Boolean).join(", ")).filter(Boolean);
    if (noms.length) d.para("Noms ou fonctions laissés volontairement : " + noms.join(" ; "), 8.5, d.f, GRIS);
  }

  // 5. Positionnement
  if (P) {
    d.titre("5", "Positionnement à l’entrée");
    for (const q of qs(mod(P))) {
      if (q.type === "choix" || q.type === "multi") {
        const n: Record<string, number> = {}; lp.forEach((r: Ctx) => [].concat(r.contenu[q.id] || []).forEach((x: string) => { n[x] = (n[x] || 0) + 1; }));
        d.place(26); d.para(q.libelle, 9.5, d.fb);
        if (q.id === "q5") d.para(`Non : ${n["Non"] || 0}    Demandes à traiter par le référent handicap : ${lp.length - (n["Non"] || 0) - lp.filter((r: Ctx) => !r.contenu.q5).length}`, 9.5);
        else d.para(q.options.map((o: string) => `${o} : ${n[o] || 0}`).join("    "), 9.5);
        const autres = lp.map((r: Ctx) => r.contenu[q.id + "_autre"]).filter(Boolean);
        if (autres.length) d.para("Autres : " + autres.join(" ; "), 9);
        d.y -= 3;
      } else if (q.type === "texte" && q.id === "q4") {
        const v = lp.map((r: Ctx) => r.contenu.q4).filter(Boolean);
        if (v.length) { d.place(26); d.para(q.libelle, 9.5, d.fb); v.forEach((x: string) => d.para("– " + x, 9, d.f, NOIR, M + 8, W - 2 * M - 8)); d.y -= 3; }
      }
    }
    d.para("Les noms des personnes ayant demandé un échange avec le référent handicap figurent seulement dans l’appli ; aucun détail de santé n’est recueilli.", 8.5, d.f, GRIS);
  }

  // 6. Appréciation des acquis
  d.titre("6", "Appréciation des acquis (par les formateurs)");
  const g = ctx.validation ? ctx.validation.grille : null;
  d.para(ctx.validation ? `Grille validée le ${ctx.validation.le}. Non notée ; non remise au participant ; alimente l’attestation de fin de formation.` : "Grille non encore validée : état provisoire.", 9, d.f, GRIS);
  C.forEach((c: Ctx, i: number) => d.para(`${i + 1}. ${c.titre}${c.indicateurs ? " – " + c.indicateurs : ""}`, 8.5, d.f, NOIR));
  d.y -= 4;
  const abr: Record<string, string> = { acquis: "A", en_cours: "EC", a_renforcer: "AR" };
  const niveaux = (id: string, k: number) => {
    if (g) { const st = g.stagiaires.find((x: Ctx) => x.id === id); return st ? st.niveaux[String(k)] : null; }
    const a = (ctx.acquis || []).find((x: Ctx) => x.stagiaire_id === id && x.critere === k); return a ? a.niveau : null;
  };
  const lw = Math.max(32, Math.min(60, (W - 2 * M - 150 - 120) / Math.max(C.length, 1)));
  d.tableau(["Stagiaire", ...C.map((_: Ctx, i: number) => String(i + 1)), "Commentaire"], [150, ...C.map(() => lw), W - 2 * M - 150 - lw * C.length],
    (ctx.stagiaires || []).map((x: Ctx) => [x.nom, ...C.map((_: Ctx, i: number) => abr[niveaux(x.id, i + 1)] || "–"),
      (g ? (g.stagiaires.find((y: Ctx) => y.id === x.id) || {}).commentaire : (ctx.commentaires || {})[x.id]) || ""]));
  d.para("A = acquis · EC = en cours · AR = à renforcer · – = non renseigné", 8.5, d.f, GRIS);
  const tot = { acquis: 0, en_cours: 0, a_renforcer: 0 } as Record<string, number>;
  (ctx.stagiaires || []).forEach((x: Ctx) => C.forEach((_: Ctx, i: number) => { const v = niveaux(x.id, i + 1); if (v) tot[v]++; }));
  d.para(`Ensemble : ${tot.acquis} acquis, ${tot.en_cours} en cours, ${tot.a_renforcer} à renforcer.`, 9.5);

  // 7. Auto-évaluations
  if (autos.length) {
    d.titre("7", "Auto-évaluation des formateurs");
    for (const a of autos) {
      const m = ctx.modeles[a.modele_id].contenu, nom = ((ctx.formateurs || []).find((f: Ctx) => f.cle === a.formateur) || { nom: a.formateur }).nom;
      d.place(20); d.para(`${nom} – ${a.le}`, 10, d.fb);
      for (const q of qs(m)) {
        const v = a.contenu[q.id], com = a.contenu[q.id + "_com"];
        if (!v && !com) continue;
        d.para(`${q.libelle} ${q.type === "texte" ? "" : "– "}${q.type === "texte" ? "" : (v || "")}${com ? " (" + com + ")" : ""}`, 9, q.type === "texte" ? d.fb : d.f);
        if (q.type === "texte") d.para(v, 9, d.f, NOIR, M + 8, W - 2 * M - 8);
        if (q.type === "choix" && v === "Non" && q.id !== "a9") ameliorer.push(`${nom} : « ${q.libelle} » – Non`);
        if (q.id === "a9" && v && v !== "Non") ameliorer.push(`${nom} : difficultés rencontrées (${v})${com ? " – " + com : ""}`);
      }
      d.y -= 6;
    }
  }

  // 8. Points à améliorer
  d.titre("8", "Points à reporter au plan d’amélioration (indicateur 32)");
  O.forEach((o, i) => { const b = lc.map((r: Ctx) => (r.contenu.obj || [])[i]).filter((x: Ctx) => x); const m = moy(b); if (m != null && m < 3) ameliorer.push(`Objectif « ${o} » : ${nf(m)} / 4 en fin de formation`); });
  if (ameliorer.length) ameliorer.forEach((a) => d.para("– " + a, 9.5));
  else d.para("Aucun point sous les seuils retenus (moyenne inférieure à 3,5 sur 5, objectif inférieur à 3 sur 4, réponse « Non » sur les besoins particuliers, la mise en pratique ou la recommandation).", 9.5);
  d.para("À relire par les formateurs : les remarques libres peuvent aussi contenir des pistes d’amélioration.", 8.5, d.f, GRIS);
  d.y -= 6;
  d.para(integrite, 8.5, d.f, GRIS);

  d.pied("version " + version);
  return await d.doc.save({ useObjectStreams: false });
}
