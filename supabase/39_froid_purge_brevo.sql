-- =====================================================================
-- 39 · Lot B (évaluations à froid), étape 2 – purge du journal Brevo des mails aux stagiaires (M2)
-- Chaque matin à 5h UTC (avant bilans-froid-quotidien à 5h10), la base appelle envois-brevo (action « purger_journal ») par pg_net.
-- La fonction serveur supprime dans Brevo (DELETE /smtp/log/{identifiant}) le journal des M2 de plus de 24 h,
-- puis le note par bil_srv_froid_ids_purges (journal de la session : nombres seulement).
-- Cette tâche n'envoie aucun mail : les envois ne partent qu'au clic d'Alexandre.
-- Secrets (Vault) :
--   froid_purge_cle : tirée au hasard ici, ne sort jamais de la base ; la fonction serveur la fait vérifier par bil_srv_froid_cle_ok.
--   anon_jwt        : jeton anon public (déjà dans l'appli), rangé à part par Claude, non recopié ici ; il ne sert qu'à passer
--                     le contrôle verify_jwt de la fonction serveur.
-- =====================================================================
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'froid_purge_cle') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'froid_purge_cle',
      'Lot B : clé de la purge du journal Brevo (envois-brevo, action purger_journal)');
  end if;
end $$;

-- Vérification de la clé de purge (fonction serveur seulement)
create function public.bil_srv_froid_cle_ok(p_cle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_cle) >= 32 and p_cle = (select decrypted_secret from vault.decrypted_secrets where name = 'froid_purge_cle'), false)
$$;

-- Appel du matin : seulement s'il y a des identifiants de plus de 24 h à purger
create function bilans.froid_purge_brevo() returns bigint
language plpgsql security definer set search_path = '' as $$
declare cle text; jwt text;
begin
  if not exists (select 1 from bilans.froid_brevo_ids where purge_demandee_le is null and cree_le <= now() - interval '24 hours') then
    return null;
  end if;
  select decrypted_secret into cle from vault.decrypted_secrets where name = 'froid_purge_cle';
  select decrypted_secret into jwt from vault.decrypted_secrets where name = 'anon_jwt';
  if cle is null or jwt is null then raise warning 'Purge du journal Brevo : secret absent de Vault.'; return null; end if;
  return net.http_post(
    url := 'https://atrjjtdhjhibobceasbp.supabase.co/functions/v1/envois-brevo',
    body := '{"action":"purger_journal"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || jwt, 'x-cle-purge', cle),
    timeout_milliseconds := 120000);
end $$;

revoke all on function public.bil_srv_froid_cle_ok(text) from public;
revoke all on function public.bil_srv_froid_cle_ok(text) from anon, authenticated;
grant execute on function public.bil_srv_froid_cle_ok(text) to service_role;
revoke all on function bilans.froid_purge_brevo() from public;
revoke all on function bilans.froid_purge_brevo() from anon, authenticated, service_role;

select cron.schedule('bilans-froid-purge-brevo', '0 5 * * *', 'select bilans.froid_purge_brevo()');
