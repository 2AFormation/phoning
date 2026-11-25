// 2A Formation – fonction serveur « envois-brevo » v6
// Lot A (convocations)
//  action "test"    {session_id, preparation_id}          : le mail exact, marqué [TEST], envoyé seulement à 2aa.formation@gmail.com
//  action "envoyer" {session_id, preparation_id, motif?}  : envoi à l'interlocuteur (Alexandre seulement), copie cachée au Gmail,
//                                                           puis fiche « Preuve d'envoi » PDF au Gmail
//  action "remise"  {session_id, envoi_id}                : statut de remise relevé auprès de Brevo
// Lot B (évaluations à froid) – fonctions bil_srv_froid_* de la migration 38
//  action "froid_test"     {session_id}                   : les deux mails exacts (M2, M3), marqués [TEST], au Gmail seulement (Alexandre)
//  action "froid_envoyer"  {session_id, controle_par}     : un mail par adresse de stagiaire (M2), sans aucune copie ; chaque adresse
//                                                           acceptée par Brevo est effacée aussitôt ; puis M3 à l'interlocuteur avec
//                                                           copie cachée au Gmail ; puis récapitulatif M4 sans adresses au Gmail (Alexandre)
//  action "froid_remise"   {session_id}                   : remise des M2 et du M3, enregistrée en nombres seulement
//                                                           (v6 : seuls les événements de remise comptent ; les ouvertures anonymes,
//                                                           dont Brevo masque l'identifiant de message, ne forment plus de faux « en cours »)
//  action "purger_journal" {}  + en-tête x-cle-purge      : suppression du journal Brevo des M2 (tâche du matin, pg_net, clé dans Vault)
// Tout est revérifié ici et par la base : rien n'est cru sur parole venant de l'écran. Rien ne part sans le clic d'Alexandre
// (aucune action d'envoi n'est appelée par une tâche programmée : la tâche du matin ne fait que purger).
// Expéditeur formation@2aformation.com, réponse vers 2aa.formation@gmail.com, texte seul.
// Brevo ajoute un pixel d'ouverture et réécrit les liens : contactPixelTrackingConsent=false rend le suivi anonyme.
// Il est obligatoire sur CHAQUE destinataire (to, cc, bcc) : brevo() refuse d'envoyer sinon (décision 1 du 22/11/2026).
// Aucune adresse de stagiaire n'est écrite dans un journal, une trace ou une réponse à l'écran.
import { createClient } from "npm:@supabase/supabase-js@2";
import { pdfPreuve } from "./pdf.ts";
import { LOGO_JPG, LOGO_L, LOGO_H } from "./ressources.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BREVO = Deno.env.get("BREVO_ENVOIS_API_KEY") || "";
const GMAIL = "2aa.formation@gmail.com";
const EXPEDITEUR = { name: "2A Formation", email: "formation@2aformation.com" };
const BUCKET = "envois";
const db = createClient(URL_, SRV, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const LOGO = Uint8Array.from(atob(LOGO_JPG), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
const hex = async (u: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", u as Uint8Array<ArrayBuffer>))).map((x) => x.toString(16).padStart(2, "0")).join("");
function enB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nom de pièce jointe sans accents et court : certains logiciels de messagerie coupent les noms longs accentués (« .pd f »).
function nomSur(n: string): string {
  const ext = n.toLowerCase().endsWith(".pdf") ? ".pdf" : "";
  let b = (ext ? n.slice(0, -4) : n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").replace(/[«»“”"]/g, "").replace(/[^A-Za-z0-9 ._'()-]/g, " ").replace(/\s+/g, " ").trim();
  if (b.length > 60) { const c = b.slice(0, 61); const i = c.lastIndexOf(" "); b = (i > 30 ? c.slice(0, i) : c.slice(0, 60)).replace(/[ :,;-]+$/, ""); }
  return (b || "document") + ext;
}
async function rpc(nom: string, args: Record<string, unknown>) { const { data, error } = await db.rpc(nom, args); if (error) throw new Error(error.message); return data; }
const journal = (sid: string, evt: string, auteur: string, detail: unknown) => db.rpc("env_srv_journal", { p_session: sid, p_evenement: evt, p_auteur: auteur, p_detail: detail });
// deno-lint-ignore no-explicit-any
type Obj = any;

// Télécharge chaque pièce et vérifie qu'elle n'a pas changé depuis l'aperçu
async function pieces(liste: Obj[]) {
  const out: { name: string; content: string; nom: string; sha256: string; octets: number }[] = [];
  for (const p of liste) {
    const r = await db.storage.from(BUCKET).download(p.chemin);
    if (r.error || !r.data) throw new Error("Pièce introuvable : " + p.nom);
    const u = new Uint8Array(await r.data.arrayBuffer());
    if ((await hex(u)) !== p.sha256) throw new Error("Envoi bloqué : le PDF « " + p.nom + " » a changé depuis l’aperçu.");
    const sur = nomSur(p.nom);
    out.push({ name: sur, content: enB64(u), nom: sur, sha256: p.sha256, octets: u.length });
  }
  return out;
}

// Suivi anonyme obligatoire : aucun destinataire sans contactPixelTrackingConsent=false
function exigerAnonyme(corps: Obj) {
  if (!Array.isArray(corps.to) || !corps.to.length) throw new Error("Envoi bloqué : aucun destinataire.");
  for (const k of ["to", "cc", "bcc"]) {
    if (corps[k] === undefined) continue;
    if (!Array.isArray(corps[k])) throw new Error("Envoi bloqué : liste de destinataires invalide.");
    for (const d of corps[k]) if (!d || typeof d.email !== "string" || d.contactPixelTrackingConsent !== false)
      throw new Error("Envoi bloqué : suivi Brevo non anonymisé pour un destinataire (" + k + ").");
  }
}
const ANONYME = (email: string) => ({ email, contactPixelTrackingConsent: false });
// Retire toute adresse e-mail d'un texte destiné à un journal ou à l'écran
const sansAdresse = (s: unknown) => String(s ?? "").replace(/[^\s<>"'@,;:()[\]]+@[^\s<>"'@,;:()[\]]+/g, "[adresse]").slice(0, 300);
// Empreinte du texte : celle calculée par la base (objet + saut de ligne + texte) doit être celle du texte envoyé
async function verifierTexte(m: Obj, quoi: string) {
  if (!m || typeof m.objet !== "string" || typeof m.texte !== "string" || !m.objet || !m.texte) throw new Error("Envoi bloqué : mail « " + quoi + " » vide.");
  if ((await hex(enc.encode(m.objet + "\n" + m.texte))) !== m.sha_texte) throw new Error("Envoi bloqué : empreinte du mail « " + quoi + " » différente.");
  if (/\{\{[A-Z_]+\}\}/.test(m.objet + m.texte)) throw new Error("Envoi bloqué : champ non rempli dans le mail « " + quoi + " ».");
}

async function brevo(corps: Obj) {
  exigerAnonyme(corps);
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST",
    headers: { "api-key": BREVO, "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify(corps) });
  const t = await r.text(); let j: Obj = {}; try { j = JSON.parse(t); } catch { /* texte */ }
  return { ok: r.ok, statut: r.status, messageId: j.messageId as string | undefined, reponse: t.slice(0, 300) };
}

// =====================================================================
// LOT B – évaluations à froid
// =====================================================================
const BUDGET_MS = 100_000;   // au-delà, l'envoi s'arrête proprement : les adresses restantes partiront au nouvel essai
const PARALLELE = 4;         // mails envoyés en même temps
const PURGE_HEURES = 24;     // le journal Brevo d'un M2 est supprimé après 24 h (le temps de relever la remise)
const tagM2 = (sid: string) => "froid-m2-" + sid, tagM3 = (sid: string) => "froid-m3-" + sid;
const REJETS = ["hardBounces", "softBounces", "bounces", "blocked", "invalid", "error"];
// Événements qui disent si un mail est arrivé. Les ouvertures et les clics n'en font pas partie : avec le suivi anonyme,
// Brevo masque leur identifiant de message (constaté au test fictif du 23/11/2026), ils ne peuvent pas être rattachés à un mail.
const REMISE_EV = ["requests", "delivered", "deferred", ...REJETS];
const jFroid = (sid: string, evt: string, detail: Record<string, unknown>) => db.rpc("bil_srv_froid_journal", { p_session: sid, p_evenement: evt, p_detail: detail });
const mailSimple = (to: Obj[], m: Obj, tags: string[], bcc?: Obj[]) => {
  const c: Obj = { sender: EXPEDITEUR, to, replyTo: { email: GMAIL, name: "2A Formation" }, subject: m.objet, textContent: m.texte, tags: ["2A Travail", ...tags] };
  if (bcc) c.bcc = bcc;
  return brevo(c);
};

async function froid(action: string, b: Obj, moi: Obj, par: string): Promise<Response> {
  const sid: string = b.session_id;

  if (action === "froid_test") {
    if (moi.role !== "admin") return json({ erreur: "Réservé à Alexandre." }, 403);
    const t = await rpc("bil_srv_froid_test", { p_session: sid, p_auteur: par });
    const res: Record<string, string> = {};
    for (const q of ["stagiaire", "etablissement"]) {
      const m = t[q];
      if (m.destinataire !== GMAIL || m.cci) return json({ erreur: "Test bloqué : destinataire autre que le Gmail de 2A Formation." }, 400);
      await verifierTexte(m, q);
      const r = await mailSimple([ANONYME(GMAIL)], m, ["froid-test"]);
      res[q] = r.ok ? "envoyé" : "échec (" + r.statut + ")";
    }
    const ok = !Object.values(res).some((x) => x !== "envoyé");
    await jFroid(sid, ok ? "froid_test_envoye" : "froid_test_echec", res);
    return ok ? json({ ok: true, ...res }) : json({ erreur: "Test : " + res.stagiaire + " / " + res.etablissement }, 502);
  }

  if (action === "froid_remise") {
    // Les événements Brevo contiennent les adresses : ils sont comptés ici, jamais gardés ni renvoyés.
    const lire = async (tag: string) => {
      const ev: Obj[] = [];
      for (let off = 0; off < 20000; off += 2500) {
        const r = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?limit=2500&offset=${off}&days=30&tags=${encodeURIComponent(tag)}`, { headers: { "api-key": BREVO, accept: "application/json" } });
        if (!r.ok) throw new Error("Brevo ne répond pas (" + r.status + ")");
        const lot = ((await r.json()).events || []) as Obj[];
        ev.push(...lot);
        if (lot.length < 2500) break;
      }
      return ev;
    };
    const parMessage = (ev: Obj[]) => {
      const m = new Map<string, string[]>();
      for (const x of ev) {
        if (String(x.email || "").toLowerCase() === GMAIL) continue;  // copie cachée du M3
        const evt = String(x.event || ""); if (!REMISE_EV.includes(evt)) continue;   // ouvertures, clics : ignorés
        const k = String(x.messageId || ""); if (!k.includes("@")) continue;          // identifiant masqué ou absent
        if (!m.has(k)) m.set(k, []); m.get(k)!.push(evt);
      }
      return [...m.values()].map((e) => e.some((x) => REJETS.includes(x)) ? "rejete" : e.includes("delivered") ? "delivre" : "en_cours");
    };
    const m2 = parMessage(await lire(tagM2(sid)));
    const m3 = parMessage(await lire(tagM3(sid)));
    const compte: Record<string, number | string> = { delivre: 0, rejete: 0, en_cours: 0 };
    for (const s of m2) compte[s] = (compte[s] as number) + 1;
    // un seul M3 par session : s'il y avait plusieurs identifiants, le plus défavorable l'emporte
    compte.etablissement = !m3.length ? "inconnu" : m3.includes("rejete") ? "rejete" : m3.includes("en_cours") ? "en_cours" : "delivre";
    await rpc("bil_srv_froid_remise", { p_session: sid, p_compte: compte, p_par: par });
    return json({ ok: true, ...compte, note: "Journal Brevo des mails aux stagiaires supprimé " + PURGE_HEURES + " h après l’envoi : relever la remise avant." });
  }

  // ---- froid_envoyer : seulement après le clic d'Alexandre, case « Documents contrôlés par » cochée ----
  if (moi.role !== "admin") return json({ erreur: "Réservé à Alexandre." }, 403);
  const cp = String(b.controle_par || "");
  if (!["Antoine", "Alexandre"].includes(cp)) return json({ erreur: "Envoi bloqué : cochez « Documents contrôlés par » (Antoine ou Alexandre)." }, 400);
  // contrôles, verrou de 5 min, ouverture des questionnaires ; refus si un contrôle est rouge ou un envoi en cours
  const d = await rpc("bil_srv_froid_debut", { p_session: sid, p_auteur: par, p_auteur_role: moi.role, p_controle_par: cp });
  const debut = Date.now();
  let envoyes = 0, effacees = 0, echecs = 0, m3_echec = false, arret = "", fini = false;
  let m3: Obj = null, f: Obj = null;
  const fin = async () => {
    f = await rpc("bil_srv_froid_fin", { p_session: sid, p: { essai: d.essai, auteur: par, controle_par: cp, envoyes, effacees, echecs,
      m2: { objet: d.stagiaire.objet, sha_texte: d.stagiaire.sha_texte, modeles: d.stagiaire.modeles }, m3, m3_echec, controles: d.controles } });
    fini = true;
  };
  try {
    await verifierTexte(d.stagiaire, "stagiaires");
    if (d.etablissement) await verifierTexte(d.etablissement, "établissement");
    const adresses: string[] = Array.isArray(d.adresses) ? d.adresses : [];
    if (adresses.length !== d.nb) throw new Error("Envoi bloqué : liste d’adresses incohérente.");

    // M2 : un mail par adresse, un seul destinataire, aucune copie
    let i = 0;
    const ouvrier = async () => {
      while (!arret && i < adresses.length) {
        if (Date.now() - debut > BUDGET_MS) { arret = "temps"; break; }
        const email = adresses[i++];
        const r = await mailSimple([ANONYME(email)], d.stagiaire, ["froid-stagiaire", tagM2(sid)]);
        if (!r.ok || !r.messageId) { echecs++; continue; }        // adresse gardée pour un nouvel essai
        envoyes++;
        let n: number | null = null;
        for (let k = 0; k < 2 && n === null; k++) { try { n = await rpc("bil_srv_froid_accepte", { p_session: sid, p_email: email, p_message_id: r.messageId }); } catch { /* nouvel essai */ } }
        if (n === null) { arret = "effacement"; break; }          // on s'arrête : une adresse partie n'a pas pu être effacée
        effacees += n;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLELE, adresses.length) }, ouvrier));

    // M3 : interlocuteur de l'établissement, copie cachée au Gmail (seulement s'il n'est pas déjà parti)
    if (d.etablissement) {
      const m = d.etablissement;
      if (arret || !m.destinataire || m.cci !== GMAIL) m3_echec = true;
      else {
        const r = await mailSimple([ANONYME(m.destinataire)], m, ["froid-etablissement", tagM3(sid)], [ANONYME(GMAIL)]);
        if (!r.ok || !r.messageId) m3_echec = true;
        else {
          m3 = { destinataire: m.destinataire, cci: GMAIL, objet: m.objet, sha_texte: m.sha_texte, modeles: m.modeles, brevo_id: r.messageId };
          let note = false;
          for (let k = 0; k < 2 && !note; k++) { try { await rpc("bil_srv_froid_m3", { p_session: sid, p_brevo_id: r.messageId }); note = true; } catch { /* nouvel essai */ } }
          if (!note) arret = arret || "m3_non_note";
        }
      }
    }
    await fin();
  } catch (e) {
    await jFroid(sid, "froid_envoi_erreur", { erreur: sansAdresse((e as Error).message), envoyes, echecs });
    arret = arret || "erreur";
  } finally {
    // un mail est parti : la trace doit être faite ; rien n'est parti : on lève seulement le verrou
    if (!fini && (envoyes > 0 || m3)) { try { await fin(); } catch (e) { await jFroid(sid, "froid_envoi_erreur", { erreur: "trace : " + sansAdresse((e as Error).message), envoyes }); } }
    if (!fini) await db.rpc("bil_srv_froid_liberer", { p_session: sid });
  }
  if (!fini) return json({ erreur: envoyes > 0 || m3
      ? envoyes + " mail(s) parti(s), adresses servies effacées, mais trace non enregistrée : prévenir Claude avant de relancer."
      : "Envoi interrompu avant tout mail : rien n’est parti, aucune adresse effacée (voir le journal)." }, 500);

  // M4 : récapitulatif au Gmail, sans aucune adresse de stagiaire
  let recap = false;
  try {
    const m = f.recap;
    if (m.destinataire !== GMAIL) throw new Error("destinataire du récapitulatif");
    await verifierTexte(m, "récapitulatif");
    const r = await mailSimple([ANONYME(GMAIL)], m, ["froid-recap"]);
    recap = r.ok;
    await jFroid(sid, r.ok ? "froid_recap_envoye" : "froid_recap_echec", { statut: String(r.statut) });
  } catch (e) { await jFroid(sid, "froid_recap_echec", { erreur: sansAdresse((e as Error).message) }); }

  const ARRETS: Record<string, string> = {
    temps: "Temps maximal atteint : relancer « Envoyer » pour les adresses restantes.",
    effacement: "Une adresse servie n’a pas pu être effacée : envoi arrêté, prévenir Claude avant de relancer.",
    m3_non_note: "Mail à l’établissement parti mais non noté : prévenir Claude avant de relancer.",
    erreur: "Erreur pendant l’envoi (voir le journal) : les mails partis sont tracés.",
  };
  return json({ ok: true, envoyes, effacees, echecs, restantes: f.restantes,
    etablissement: m3 ? "envoyé" : m3_echec ? "à refaire" : "déjà envoyé", recap, alerte: arret ? ARRETS[arret] : null });
}

// Tâche du matin (pg_net) : supprime dans Brevo le journal des M2 de plus de 24 h. Aucune adresse ne transite :
// seuls les identifiants de message sont gardés en base (bilans.froid_brevo_ids, effacés à 3 jours).
async function purgerJournal(req: Request): Promise<Response> {
  const cle = req.headers.get("x-cle-purge") || "";
  if (cle.length < 32 || !(await rpc("bil_srv_froid_cle_ok", { p_cle: cle }))) return json({ erreur: "accès refusé" }, 403);
  if (!BREVO) return json({ erreur: "Clé Brevo absente du serveur." }, 500);
  const ids = ((await rpc("bil_srv_froid_ids", { p_heures: PURGE_HEURES })) || []) as Obj[];
  const faits: string[] = []; let absents = 0, echecs = 0; const debut = Date.now();
  for (const x of ids) {
    if (Date.now() - debut > BUDGET_MS) break;
    const r = await fetch("https://api.brevo.com/v3/smtp/log/" + encodeURIComponent(x.message_id), { method: "DELETE", headers: { "api-key": BREVO, accept: "application/json" } });
    await r.body?.cancel();
    if (r.ok) faits.push(x.id);
    else if (r.status === 404) absents++;   // non noté comme purgé : visible dans la trace de la tâche quotidienne (sans_purge_brevo)
    else echecs++;
  }
  const notes = faits.length ? await rpc("bil_srv_froid_ids_purges", { p_ids: faits }) : 0;
  return json({ ok: true, a_purger: ids.length, purges: notes, absents, echecs });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ erreur: "méthode" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");
    if (action === "purger_journal") return await purgerJournal(req);
    const auth = req.headers.get("Authorization") || "";
    if (!UUID.test(b.session_id || "") || !auth) return json({ erreur: "demande incomplète" }, 400);
    // droit demandé à la base pour chaque action (envoyer : Alexandre seulement)
    const DROIT: Record<string, string> = { test: "test", envoyer: "envoyer", remise: "remise", froid_test: "test", froid_envoyer: "envoyer", froid_remise: "remise" };
    if (!Object.hasOwn(DROIT, action)) return json({ erreur: "action inconnue" }, 400);
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: moi, error: e1 } = await user.rpc("env_exiger", { p_session: b.session_id, p_action: DROIT[action] });
    if (e1 || !moi) return json({ erreur: (e1 && e1.message) || "accès refusé" }, 403);
    const par = moi.nom || moi.email;
    if (!BREVO) return json({ erreur: "Clé Brevo « Envois 2A Travail » absente du serveur." }, 500);
    if (action.startsWith("froid_")) return await froid(action, b, moi, par);

    if (action === "remise") {
      if (!UUID.test(b.envoi_id || "")) return json({ erreur: "envoi" }, 400);
      const e = await rpc("env_srv_envoi_lire", { p_envoi: b.envoi_id });
      if (!e || e.session_id !== b.session_id || !e.brevo_id) return json({ erreur: "envoi introuvable" }, 404);
      const lire = async (q: string) => {
        const r = await fetch("https://api.brevo.com/v3/smtp/statistics/events?limit=500&" + q, { headers: { "api-key": BREVO, accept: "application/json" } });
        if (!r.ok) throw new Error("Brevo ne répond pas (" + r.status + ")");
        return ((await r.json()).events || []) as Obj[];
      };
      // par identifiant de message ; sinon par adresse sur 30 jours, filtré sur l'identifiant (les événements arrivent avec un délai)
      let ev = await lire("messageId=" + encodeURIComponent(e.brevo_id));
      if (!ev.length) ev = (await lire("days=30&email=" + encodeURIComponent(e.destinataire))).filter((x) => x.messageId === e.brevo_id);
      const pour = (m: string) => ev.filter((x) => String(x.email || "").toLowerCase() === m.toLowerCase()).map((x) => x.event);
      const dest = pour(e.destinataire);
      const REJ = ["hardBounces", "softBounces", "bounces", "blocked", "invalid", "error"];
      const statut = dest.some((x) => REJ.includes(x)) ? "rejete" : dest.includes("delivered") ? "delivre" : dest.length ? "en_cours" : "inconnu";
      const detail = { destinataire: dest, copie_cachee: e.cci ? pour(e.cci) : [], releve: new Date().toISOString() };
      await rpc("env_srv_remise", { p_envoi: e.id, p_statut: statut, p_detail: detail, p_par: par });
      return json({ ok: true, statut, detail });
    }

    if (!UUID.test(b.preparation_id || "")) return json({ erreur: "préparation" }, 400);
    const test = action === "test";
    const ctx = await rpc("env_srv_envoi_contexte", { p_preparation: b.preparation_id, p_test: test, p_motif: b.motif || null, p_auteur_role: moi.role });
    if (ctx.session.id !== b.session_id) return json({ erreur: "session" }, 400);
    const m = ctx.mail;
    if (!test && !m.destinataire) return json({ erreur: "destinataire absent" }, 400);

    // anti double clic : un seul envoi à la fois par préparation
    if (!test && !(await rpc("env_srv_verrou", { p_preparation: b.preparation_id, p_prendre: true }))) return json({ erreur: "Envoi déjà en cours." }, 409);
    let envoye = false;
    try {
      const pj = await pieces(ctx.pieces);
      const shaTexte = await hex(enc.encode(m.objet + "\n\n" + m.texte));
      const corps: Obj = { sender: EXPEDITEUR, to: [{ email: test ? GMAIL : m.destinataire, contactPixelTrackingConsent: false }], replyTo: { email: GMAIL, name: "2A Formation" },
        subject: m.objet, textContent: m.texte, attachment: pj.map((x) => ({ name: x.name, content: x.content })), tags: ["2A Travail", test ? "test" : "convocations"] };
      if (!test) corps.bcc = [ANONYME(GMAIL)];  // v5 : copie cachée anonyme elle aussi (défaut du lot A corrigé)
      const r = await brevo(corps);
      if (!r.ok || !r.messageId) {
        await journal(b.session_id, test ? "test_echec" : "envoi_echec", par, { statut: r.statut, reponse: r.reponse });
        return json({ erreur: "Brevo a refusé l’envoi (" + r.statut + ") : " + r.reponse }, 502);
      }
      envoye = true;
      const piecesTrace = pj.map((x) => ({ nom: x.nom, sha256: x.sha256, octets: x.octets }));
      let id: string;
      try { id = await rpc("env_srv_envoi", { p: { preparation_id: b.preparation_id, type: ctx.type, motif: b.motif || null, auteur: par,
        controle_par: ctx.controle_par, expediteur: EXPEDITEUR.email, destinataire: test ? GMAIL : m.destinataire, cci: test ? null : GMAIL,
        objet: m.objet, sha_texte: shaTexte, pieces: piecesTrace, modeles: ctx.modeles, controles: ctx.controles, brevo_id: r.messageId } }); }
      catch (e) {
        await journal(b.session_id, "trace_echec", par, { brevo_id: r.messageId, erreur: String((e as Error).message).slice(0, 300) });
        return json({ erreur: "Mail parti (identifiant Brevo " + r.messageId + ") mais trace non enregistrée : prévenir Claude." }, 500);
      }
      if (test) return json({ ok: true, type: "test", envoi_id: id });

      // fiche « Preuve d'envoi » : PDF rangé, empreinte enregistrée, envoyé au Gmail seulement
      const tr = await rpc("env_srv_envoi_lire", { p_envoi: id });
      let preuve = false;
      try {
        const pdf = await pdfPreuve({ ...tr, code: ctx.session.code, intitule: ctx.session.intitule, texte: m.texte, pieces: piecesTrace,
          type_txt: ctx.type === "corrige" ? "Version corrigée (annule et remplace)" : "Premier envoi", modeles_txt: ctx.modeles.convocation + ", " + ctx.modeles.mail,
          produite_le: ctx.maintenant }, LOGO, LOGO_L, LOGO_H);
        const sha = await hex(pdf);
        const chemin = `${b.session_id}/preuves/preuve_${sha.slice(0, 12)}_${crypto.randomUUID().slice(0, 8)}.pdf`;
        const nom = `Preuve_envoi_convocations_${ctx.session.code}_v${ctx.version}.pdf`;
        const up = await db.storage.from(BUCKET).upload(chemin, pdf, { contentType: "application/pdf", upsert: false });
        if (up.error) throw new Error(up.error.message);
        await rpc("env_srv_document", { p_preparation: b.preparation_id, p_type: "preuve", p_stagiaire: null, p_nom: nom, p_chemin: chemin, p_sha256: sha, p_octets: pdf.length, p_envoi: id });
        const vals: Record<string, string> = { CODE: ctx.session.code, LE: tr.le, AUTEUR: par, CONTROLE_PAR: ctx.controle_par, DESTINATAIRE: m.destinataire, CCI: GMAIL, NB_PIECES: String(pj.length), SHA: sha };
        const objet = `[2A Travail] Preuve d’envoi des convocations – ${ctx.session.code}`;
        const texte = `Convocations envoyées le ${vals.LE} (heure du serveur) par ${vals.AUTEUR}, documents contrôlés par ${vals.CONTROLE_PAR}.\nDestinataire : ${vals.DESTINATAIRE} – copie cachée : ${vals.CCI}.\nPièces jointes : ${vals.NB_PIECES}.\n\nLa fiche « Preuve d’envoi » est jointe : à ranger dans le dossier 1_Convention_de_formation de la session, après vérification de son empreinte SHA-256 (${sha}).\n\n2A Travail – envois`;
        const r2 = await brevo({ sender: EXPEDITEUR, to: [{ email: GMAIL, contactPixelTrackingConsent: false }], subject: objet, textContent: texte, attachment: [{ name: nom, content: enB64(pdf) }], tags: ["2A Travail", "preuve"] });
        preuve = r2.ok;
        await journal(b.session_id, r2.ok ? "preuve_envoyee" : "preuve_echec", par, { sha256: sha, statut: r2.statut });
      } catch (e) { await journal(b.session_id, "preuve_echec", par, { erreur: String((e as Error).message).slice(0, 300) }); }
      return json({ ok: true, type: ctx.type, envoi_id: id, preuve });
    } finally {
      if (!test && !envoye) await db.rpc("env_srv_verrou", { p_preparation: b.preparation_id, p_prendre: false });
    }
  } catch (e) {
    return json({ erreur: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
