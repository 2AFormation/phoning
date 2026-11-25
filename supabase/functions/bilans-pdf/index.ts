// 2A Formation – fonction serveur « bilans-pdf » v5 (v5 : écarts arrondis comme le plan d’amélioration, statut de remise en clair)
//  action "produire" {session_id}            : PDF « Bilan de la formation » (nouvelle version à chaque appel,
//                                              jamais de remplacement), rangé dans le stockage privé « bilans »,
//                                              empreinte SHA-256 enregistrée, envoi par mail à 2aa.formation et aux formateurs.
//  action "froid" {session_id}               : PDF « Bilan à froid » (lot B, migration 40), même principe ; compte d'Alexandre
//                                              seulement, les deux questionnaires à froid fermés ; mail à 2aa.formation seulement.
//  action "lien" {session_id, document_id}   : lien de lecture de 5 min (bilan de la formation ou bilan à froid).
// Toutes les actions exigent le compte d'un formateur de la session (contrôle fait par la base : bil_verifier).
// Aucune session fictive ne reçoit de mail : son PDF se lit avec l'action « lien ».
import { createClient } from "npm:@supabase/supabase-js@2";
import { pdfBilan } from "./pdf.ts";
import { pdfFroid } from "./froid.ts";
import { LOGO_JPG } from "./ressources.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BREVO = Deno.env.get("BREVO_API_KEY") || "";
const COPIE = Deno.env.get("EMARGEMENT_COPIE") || "2aa.formation@gmail.com";
const EXPEDITEUR = { name: "2A Formation – Bilans", email: Deno.env.get("EMARGEMENT_EXPEDITEUR") || "emargement@2aformation.com" };
const BUCKET = "bilans";
const db = createClient(URL_, SRV, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const LOGO = Uint8Array.from(atob(LOGO_JPG), (c) => c.charCodeAt(0));
const hex = async (u: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", u as Uint8Array<ArrayBuffer>))).map((x) => x.toString(16).padStart(2, "0")).join("");
function enB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function journal(sid: string, evenement: string, detail: unknown) { await db.rpc("bil_srv_journal", { p_session: sid, p_evenement: evenement, p_detail: detail }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ erreur: "méthode" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const auth = req.headers.get("Authorization") || "";
    if (!UUID.test(b.session_id || "") || !auth) return json({ erreur: "demande incomplète" }, 400);
    // contrôle d'accès par la base, avec le compte de la personne
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: integ, error: e1 } = await user.rpc("bil_verifier", { p_session: b.session_id });
    if (e1) return json({ erreur: "accès refusé" }, 403);
    const { data: u } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    const par = (u && u.user && u.user.email) || "formateur";

    if (b.action === "lien") {
      if (!UUID.test(b.document_id || "")) return json({ erreur: "document" }, 400);
      // le chemin est relu dans la base (jamais fourni par le navigateur)
      const { data: docs, error: e2 } = await db.rpc("bil_srv_documents", { p_session: b.session_id });
      if (e2) throw new Error(e2.message);
      // deno-lint-ignore no-explicit-any
      const o = (docs || []).find((x: any) => x.id === b.document_id);
      if (!o) return json({ erreur: "document introuvable" }, 404);
      const s = await db.storage.from(BUCKET).createSignedUrl(o.chemin, 300, { download: false });
      if (s.error) throw new Error(s.error.message);
      return json({ url: s.data.signedUrl, sha256: o.sha256 });
    }

    if (b.action === "produire") {
      const { data: ctx, error } = await db.rpc("bil_srv_contexte", { p_session: b.session_id });
      if (error) throw new Error(error.message);
      const version = ctx.version;
      const integrite = integ && integ.ok ? `Contrôle d’intégrité des bilans au moment de la production : ${integ.lignes} enregistrements, chaîne d’empreintes intacte (dernière empreinte ${String(ctx.derniere || "").slice(0, 16)}…).`
        : "ATTENTION : le contrôle d’intégrité des bilans a signalé un problème. Prévenir Alexandre.";
      let pdf: Uint8Array;
      try { pdf = await pdfBilan(ctx, LOGO, version, integrite); }
      catch (e) { await journal(b.session_id, "pdf_echec", { erreur: String((e as Error).message).slice(0, 300) }); throw e; }
      const sha = await hex(pdf), s = ctx.session;
      const nom = `Bilan_formation_${s.code}_v${version}.pdf`;
      const chemin = `${s.code}/bilan_v${version}_${sha.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}.pdf`;
      const up = await db.storage.from(BUCKET).upload(chemin, pdf, { contentType: "application/pdf", upsert: false });
      if (up.error) throw new Error("stockage : " + up.error.message);
      const { error: e3 } = await db.rpc("bil_srv_document", { p_session: b.session_id, p_version: version, p_chemin: chemin, p_sha256: sha, p_octets: pdf.length, p_par: par });
      if (e3) throw new Error(e3.message);
      let mail = false;
      if (BREVO && !s.fictive) {
        const dest = new Map<string, { email: string }>(); dest.set(COPIE.toLowerCase(), { email: COPIE });
        // deno-lint-ignore no-explicit-any
        for (const f of ctx.formateurs || []) if ((f as any).email) dest.set(String((f as any).email).toLowerCase(), { email: (f as any).email });
        const r = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST", headers: { "api-key": BREVO, "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender: EXPEDITEUR, to: [...dest.values()], replyTo: { email: COPIE, name: "2A Formation" },
            subject: `Bilan de la formation – ${s.code} – version ${version}`,
            textContent: `Bilan de la formation « ${s.intitule} » (${s.dates}), version ${version}, produit le ${ctx.maintenant} (heure du serveur).\n\nÀ ranger dans le dossier 7_Evaluations de la session.\n\nFichier : ${nom}\nEmpreinte SHA-256 du PDF : ${sha}\n\n2A Formation – bilans de formation`,
            attachment: [{ content: enB64(pdf), name: nom }] }),
        });
        mail = r.ok;
        await journal(b.session_id, r.ok ? "mail_envoye" : "mail_echec", r.ok ? { destinataires: dest.size, fichier: nom, sha256: sha } : { statut: r.status, reponse: (await r.text()).slice(0, 300) });
      } else await journal(b.session_id, "mail_echec", { raison: s.fictive ? "session fictive : pas de mail" : "clé Brevo absente", fichier: nom });
      return json({ ok: true, version, sha256: sha, mail });
    }

    if (b.action === "froid") {
      const { error: e4 } = await user.rpc("bil_froid_bilan_exiger", { p_session: b.session_id });
      if (e4) return json({ erreur: e4.message || "accès refusé" }, 403);
      // refus par la base tant que les deux questionnaires à froid ne sont pas fermés
      const { data: ctx, error } = await db.rpc("bil_srv_froid_contexte", { p_session: b.session_id });
      if (error) return json({ erreur: error.message }, 409);
      const version = ctx.version, s = ctx.session;
      const integrite = integ && integ.ok ? `Contrôle d’intégrité des bilans au moment de la production : ${integ.lignes} enregistrements, chaîne d’empreintes intacte (dernière empreinte ${String(ctx.derniere || "").slice(0, 16)}…).`
        : "ATTENTION : le contrôle d’intégrité des bilans a signalé un problème. Prévenir Alexandre.";
      let pdf: Uint8Array;
      try { pdf = await pdfFroid(ctx, LOGO, version, integrite); }
      catch (e) { await db.rpc("bil_srv_froid_pdf_journal", { p_session: b.session_id, p_evenement: "froid_pdf_echec", p_detail: { erreur: String((e as Error).message).slice(0, 300) } }); throw e; }
      const sha = await hex(pdf);
      const nom = `Bilan_a_froid_${s.code}_v${version}.pdf`;
      const chemin = `${s.code}/froid_v${version}_${sha.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}.pdf`;
      const up = await db.storage.from(BUCKET).upload(chemin, pdf, { contentType: "application/pdf", upsert: false });
      if (up.error) throw new Error("stockage : " + up.error.message);
      const { data: doc, error: e3 } = await db.rpc("bil_srv_froid_document", { p_session: b.session_id, p_version: version, p_chemin: chemin, p_sha256: sha, p_octets: pdf.length, p_par: par });
      if (e3) throw new Error(e3.message);
      let mail = false;
      const jf = (evt: string, detail: unknown) => db.rpc("bil_srv_froid_pdf_journal", { p_session: b.session_id, p_evenement: evt, p_detail: detail });
      if (BREVO && !s.fictive) {
        // un seul destinataire : la boîte de 2A (suivi Brevo anonyme, comme pour tout l'à froid)
        const r = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST", headers: { "api-key": BREVO, "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender: EXPEDITEUR, to: [{ email: COPIE, contactPixelTrackingConsent: false }], replyTo: { email: COPIE, name: "2A Formation" },
            subject: `Bilan à froid – ${s.code} – version ${version}`,
            textContent: `Bilan à froid de la formation « ${s.intitule} » (${s.dates}), version ${version}, produit le ${ctx.maintenant} (heure du serveur).\n\nÀ ranger dans le dossier 7_Evaluations de la session, après vérification de l’empreinte.\n\nFichier : ${nom}\nEmpreinte SHA-256 du PDF : ${sha}\n\n2A Formation – bilans de formation`,
            attachment: [{ content: enB64(pdf), name: nom }] }),
        });
        mail = r.ok;
        await jf(r.ok ? "froid_pdf_mail_envoye" : "froid_pdf_mail_echec", r.ok ? { destinataires: 1, fichier: nom, sha256: sha } : { statut: r.status, reponse: (await r.text()).slice(0, 300) });
      } else await jf("froid_pdf_mail_echec", { raison: s.fictive ? "session fictive : pas de mail" : "clé Brevo absente", fichier: nom });
      return json({ ok: true, version, sha256: sha, mail, document_id: doc && doc.id });
    }
    return json({ erreur: "action inconnue" }, 400);
  } catch (e) {
    return json({ erreur: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
