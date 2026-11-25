// Essai hors ligne de envois-brevo v6 : Brevo et la base sont simulés, aucun appel réseau réel.
const vraiFetch = globalThis.fetch;
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((x) => x.toString(16).padStart(2, "0")).join("");
const mail = async (objet: string, texte: string, dest: string | null, cci: string | null) => ({ objet, texte, modeles: "m", sha_texte: await sha(objet + "\n" + texte), destinataire: dest, cci });
let S: any; // état du scénario
const rpcs: { nom: string; args: any }[] = []; const brevos: any[] = []; const deletes: string[] = [];
async function repondreRpc(nom: string, args: any) {
  rpcs.push({ nom, args });
  switch (nom) {
    case "env_exiger": return S.role ? { cle: "k", role: S.role, nom: "Alexandre Bigot", email: "x@y.fr" } : null;
    case "bil_srv_froid_test": return { stagiaire: await mail("[TEST] A froid", "texte M2", "2aa.formation@gmail.com", null), etablissement: await mail("[TEST] Etab", "texte M3", "2aa.formation@gmail.com", null) };
    case "bil_srv_froid_debut": {
      const st = await mail("Questionnaire", "Bonjour, lien https://app/x", null, null);
      if (S.casse) st.texte += " modifié";
      return { essai: 1, adresses: S.adresses, nb: S.adresses.length, stagiaire: st,
        etablissement: await mail("Questionnaire établissement", "Madame, lien", "interlocuteur+test@gmail.com", "2aa.formation@gmail.com"), controles: [{ id: "a", niveau: "vert" }], controle_par: args.p_controle_par };
    }
    case "bil_srv_froid_accepte": return 1;
    case "bil_srv_froid_m3": return null;
    case "bil_srv_froid_fin": return { restantes: args.p.echecs, recap: await mail("Recap", "2 envoyés", "2aa.formation@gmail.com", null) };
    case "bil_srv_froid_cle_ok": return args.p_cle === "c".repeat(40);
    case "bil_srv_froid_ids": return [{ id: "00000000-0000-0000-0000-000000000001", message_id: "<1@smtp>" }, { id: "00000000-0000-0000-0000-000000000002", message_id: "<2@smtp>" }];
    case "bil_srv_froid_ids_purges": return args.p_ids.length;
    default: return null;
  }
}
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.startsWith("http://localhost:8765")) return vraiFetch(input, init);
  const corps = init?.body ? JSON.parse(init.body) : (input.body ? await new Response(input.body).json() : {});
  const m = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/);
  if (m) return new Response(JSON.stringify(await repondreRpc(m[1], corps)), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/smtp/email")) { brevos.push(corps); const ko = corps.to[0].email === S.echoue; return new Response(JSON.stringify(ko ? { message: "refus" } : { messageId: "<" + brevos.length + "@smtp>" }), { status: ko ? 400 : 201 }); }
  if (url.includes("/smtp/log/")) { deletes.push(url); return new Response(null, { status: url.includes("2%40") ? 404 : 204 }); }
  if (url.includes("/smtp/statistics/events")) return new Response(JSON.stringify({ events: S.evenements ?? [{ messageId: "<a@smtp>", email: "s1@x.fr", event: "delivered" }, { messageId: "<b@smtp>", email: "s2@x.fr", event: "hardBounces" }] }), { status: 200 });
  throw new Error("appel imprévu " + url);
};
Deno.env.set("SUPABASE_URL", "https://faux.supabase.co"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "srv"); Deno.env.set("SUPABASE_ANON_KEY", "anon"); Deno.env.set("BREVO_ENVOIS_API_KEY", "brevo");
const origServe = Deno.serve; (Deno as any).serve = (h: any) => origServe({ port: 8765, onListen() {} }, h);
await import("./functions/envois-brevo/index.ts");
const SID = "11111111-1111-4111-8111-111111111111";
const appel = async (b: any, h: Record<string, string> = { Authorization: "Bearer jwt" }) => { const r = await vraiFetch("http://localhost:8765", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
const verif = (c: boolean, t: string) => { console.log((c ? "OK   " : "ÉCHEC") + " " + t); if (!c) Deno.exitCode = 1; };
const reset = (s: any) => { S = s; rpcs.length = 0; brevos.length = 0; deletes.length = 0; };
const adr = ["s1@x.fr", "s2@x.fr", "s3@x.fr", "s4@x.fr", "s5@x.fr"];

// 1. envoi normal, une adresse refusée par Brevo
reset({ role: "admin", adresses: adr, echoue: "s3@x.fr" });
let r = await appel({ action: "froid_envoyer", session_id: SID, controle_par: "Antoine" });
verif(r.s === 200 && r.j.envoyes === 4 && r.j.echecs === 1 && r.j.effacees === 4, "envoi : 4 envoyés, 1 échec, 4 effacées " + JSON.stringify(r.j));
verif(brevos.every((c) => ["to", "cc", "bcc"].every((k) => !c[k] || c[k].every((d: any) => d.contactPixelTrackingConsent === false))), "chaque destinataire, copie cachée comprise, avec false");
const m2 = brevos.filter((c) => c.tags.includes("froid-stagiaire"));
verif(m2.length === 5 && m2.every((c) => c.to.length === 1 && !c.bcc && !c.cc), "M2 : un mail par adresse, aucune copie");
const m3 = brevos.find((c) => c.tags.includes("froid-etablissement"));
verif(!!m3 && m3.bcc?.[0]?.email === "2aa.formation@gmail.com" && brevos.indexOf(m3) > brevos.indexOf(m2[4]), "M3 après les M2, copie cachée au Gmail");
verif(brevos[brevos.length - 1].tags.includes("froid-recap") && brevos[brevos.length - 1].to[0].email === "2aa.formation@gmail.com", "M4 en dernier, au Gmail");
const acc = rpcs.filter((x) => x.nom === "bil_srv_froid_accepte").map((x) => x.args.p_email).sort();
verif(JSON.stringify(acc) === JSON.stringify(["s1@x.fr", "s2@x.fr", "s4@x.fr", "s5@x.fr"]), "seules les adresses acceptées sont effacées");
const finArgs = rpcs.find((x) => x.nom === "bil_srv_froid_fin")!.args.p;
verif(!JSON.stringify(finArgs).match(/s\d@x\.fr/), "trace de fin sans adresse de stagiaire");
verif(!JSON.stringify(rpcs.filter((x) => x.nom === "bil_srv_froid_journal")).match(/s\d@x\.fr/), "journal sans adresse de stagiaire");
verif(!JSON.stringify(r.j).match(/@/), "réponse à l'écran sans adresse");

// 2. case « Documents contrôlés par » absente
reset({ role: "admin", adresses: adr });
r = await appel({ action: "froid_envoyer", session_id: SID });
verif(r.s === 400 && !rpcs.some((x) => x.nom === "bil_srv_froid_debut") && brevos.length === 0, "sans case contrôlée : refus, rien ne part");

// 3. formateur (pas Alexandre)
reset({ role: "formateur", adresses: adr });
r = await appel({ action: "froid_envoyer", session_id: SID, controle_par: "Antoine" });
verif(r.s === 403 && brevos.length === 0, "formateur : refus");
r = await appel({ action: "froid_test", session_id: SID });
verif(r.s === 403 && brevos.length === 0, "formateur : test refusé");

// 4. texte modifié entre la base et l'envoi
reset({ role: "admin", adresses: adr, casse: true });
r = await appel({ action: "froid_envoyer", session_id: SID, controle_par: "Alexandre" });
verif(r.s === 500 && brevos.length === 0 && rpcs.some((x) => x.nom === "bil_srv_froid_liberer") && !rpcs.some((x) => x.nom === "bil_srv_froid_fin"), "empreinte différente : rien ne part, verrou levé");

// 5. test
reset({ role: "admin", adresses: adr });
r = await appel({ action: "froid_test", session_id: SID });
verif(r.s === 200 && brevos.length === 2 && brevos.every((c) => c.to.length === 1 && c.to[0].email === "2aa.formation@gmail.com" && !c.bcc), "test : 2 mails au Gmail seulement");

// 6. remise
reset({ role: "formateur", adresses: adr });
r = await appel({ action: "froid_remise", session_id: SID });
const rem = rpcs.find((x) => x.nom === "bil_srv_froid_remise")?.args.p_compte;
verif(r.s === 200 && rem?.delivre === 1 && rem?.rejete === 1 && !JSON.stringify(rem).includes("@") && !JSON.stringify(r.j).includes("@"), "remise : nombres seulement " + JSON.stringify(rem));

// 6 bis. remise avec le suivi anonyme constaté au test fictif du 23/11/2026 : 4 mails délivrés, ouvertures anonymes
// (identifiant de message masqué), copie cachée du Gmail : 4 délivrés, 0 en cours, établissement délivré
const ev: any[] = [];
for (const n of [1, 2, 3, 4]) ev.push({ messageId: `<m${n}@smtp-relay.mailin.fr>`, email: `s${n}@x.fr`, event: "requests" }, { messageId: `<m${n}@smtp-relay.mailin.fr>`, email: `s${n}@x.fr`, event: "delivered" },
  { messageId: "Anonymised-" + n, email: "Anonymised", event: "opened" }, { messageId: "", email: "", event: "loadedByProxy" }, { messageId: "Anonymised", email: "Anonymised", event: "clicks" });
ev.push({ messageId: "<m3x@smtp-relay.mailin.fr>", email: "2aa.formation@gmail.com", event: "delivered" });
reset({ role: "admin", adresses: adr, evenements: ev });
r = await appel({ action: "froid_remise", session_id: SID });
const rem2 = rpcs.find((x) => x.nom === "bil_srv_froid_remise")?.args.p_compte;
verif(r.s === 200 && rem2?.delivre === 4 && rem2?.en_cours === 0 && rem2?.rejete === 0, "remise anonyme : 4 délivrés, 0 en cours " + JSON.stringify(rem2));
// un mail encore en route (seulement « requests ») reste « en cours » ; un rejet l'emporte sur « delivered »
reset({ role: "admin", adresses: adr, evenements: [{ messageId: "<p@s>", email: "s1@x.fr", event: "requests" }, { messageId: "<q@s>", email: "s2@x.fr", event: "delivered" }, { messageId: "<q@s>", email: "s2@x.fr", event: "softBounces" }, { messageId: "Anonymised", email: "Anonymised", event: "opened" }] });
r = await appel({ action: "froid_remise", session_id: SID });
const rem3 = rpcs.find((x) => x.nom === "bil_srv_froid_remise")?.args.p_compte;
verif(rem3?.en_cours === 1 && rem3?.rejete === 1 && rem3?.delivre === 0 && rem3?.etablissement === "rejete", "remise : en route et rejet bien comptés " + JSON.stringify(rem3));
// aucun événement : établissement inconnu
reset({ role: "admin", adresses: adr, evenements: [] });
r = await appel({ action: "froid_remise", session_id: SID });
const rem4 = rpcs.find((x) => x.nom === "bil_srv_froid_remise")?.args.p_compte;
verif(rem4?.delivre === 0 && rem4?.en_cours === 0 && rem4?.etablissement === "inconnu", "remise : rien encore chez Brevo " + JSON.stringify(rem4));

// 7. purge
reset({});
r = await appel({ action: "purger_journal" }, { Authorization: "Bearer anon", "x-cle-purge": "mauvaise-cle-mauvaise-cle-mauvaise-cle" });
verif(r.s === 403 && deletes.length === 0, "purge : mauvaise clé refusée");
r = await appel({ action: "purger_journal" }, { Authorization: "Bearer anon", "x-cle-purge": "c".repeat(40) });
const pur = rpcs.find((x) => x.nom === "bil_srv_froid_ids_purges")?.args.p_ids;
verif(r.s === 200 && deletes.length === 2 && deletes[0].endsWith("%3C1%40smtp%3E") && pur?.length === 1 && r.j.absents === 1, "purge : identifiant encodé, 404 non noté purgé " + JSON.stringify(r.j));

// 8. lot A : copie cachée des convocations désormais anonyme
const src = await Deno.readTextFile("./functions/envois-brevo/index.ts");
verif(src.includes("corps.bcc = [ANONYME(GMAIL)]") && !src.includes("corps.bcc = [{ email: GMAIL }]"), "lot A : copie cachée avec false");
Deno.exit();
