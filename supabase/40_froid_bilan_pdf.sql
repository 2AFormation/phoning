-- =====================================================================
-- 40 · Lot B (évaluations à froid) – étape 3 : PDF « Bilan à froid »
-- Projet Supabase « 2a-phoning ». Cahier des charges : doc Claude « Cahier des charges –
-- Convocations et évaluations à froid depuis 2A Travail », section 6 (clôture) et section 8
-- (indicateurs 11, 30, 32). Utilisé par la fonction serveur bilans-pdf v4, action « froid ».
-- Rien n'est envoyé ici. Aucune adresse de stagiaire n'entre dans le PDF ni dans le journal.
-- Aucune donnée réelle ; ne touche pas aux lignes existantes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nouveau type de document (numérotation des versions séparée par type)
-- ---------------------------------------------------------------------
alter table bilans.documents drop constraint documents_type_check;
alter table bilans.documents add constraint documents_type_check check (type in ('pdf_resultats', 'pdf_froid'));

-- ---------------------------------------------------------------------
-- 2. Fonctions existantes complétées (définition en base relue et modifiée à un seul endroit,
--    comme pour les rappels en migration 38 ; arrêt si le passage attendu n'est pas trouvé une fois)
--    · bil_srv_contexte : la version du « Bilan de la formation » ne compte que ses propres PDF
--    · bil_session      : la liste de l'onglet Bilans ne montre que les « Bilan de la formation »
--    · bil_froid_etat   : l'étape « À froid » reçoit la liste des « Bilan à froid »
-- ---------------------------------------------------------------------
do $do$
declare
  p record; d text; n int;
begin
  for p in select * from (values
    ('public.bil_srv_contexte(uuid)',
     $a$'version', (select coalesce(max(version), 0) + 1 from bilans.documents where session_id = e.id),$a$,
     $a$'version', (select coalesce(max(version), 0) + 1 from bilans.documents where session_id = e.id and type = 'pdf_resultats'),$a$),
    ('public.bil_session(text)',
     $a$from bilans.documents o where o.session_id = e.id));$a$,
     $a$from bilans.documents o where o.session_id = e.id and o.type = 'pdf_resultats'));$a$),
    ('public.bil_froid_etat(uuid)',
     $a$'controles', c, 'rouges', bilans.froid_rouges(c),$a$,
     $a$'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'version', o.version, 'sha256', o.sha256,
                     'le', to_char(o.horodatage at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')) order by o.version), '[]')
                  from bilans.documents o where o.session_id = p_session and o.type = 'pdf_froid'),
    'controles', c, 'rouges', bilans.froid_rouges(c),$a$)
  ) v(fn, avant, apres) loop
    d := pg_get_functiondef(p.fn::regprocedure);
    if position(p.apres in d) > 0 then raise notice '% : déjà modifiée.', p.fn; continue; end if;
    n := (length(d) - length(replace(d, p.avant, ''))) / length(p.avant);
    if n <> 1 then raise exception '% : passage attendu trouvé % fois (1 attendu) : rien n''est modifié.', p.fn, n; end if;
    execute replace(d, p.avant, p.apres);
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- 3. APPLI : le bilan à froid se produit depuis le compte d'Alexandre seulement
-- ---------------------------------------------------------------------
create function public.bil_froid_bilan_exiger(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f emargement.formateurs := bilans.exiger_admin();
begin
  perform bilans.exiger(p_session);
  return jsonb_build_object('cle', f.cle);
end $$;

-- ---------------------------------------------------------------------
-- 4. FONCTION SERVEUR bilans-pdf (service_role)
-- ---------------------------------------------------------------------
-- Contexte du bilan à froid : celui du bilan de la formation (objectifs, à chaud, positionnement)
-- + l'état de l'à froid en nombres. Refus tant que les deux questionnaires à froid ne sont pas fermés.
create function public.bil_srv_froid_contexte(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare fr bilans.froid; cs bilans.campagnes; cr bilans.campagnes; dernier jsonb;
begin
  select * into fr from bilans.froid where session_id = p_session;
  if fr.session_id is null then raise exception 'À froid non préparé pour cette session.'; end if;
  select * into cs from bilans.campagnes where session_id = p_session and type = 'froid_stagiaire';
  select * into cr from bilans.campagnes where session_id = p_session and type = 'froid_responsable';
  if cs.etat is distinct from 'fermee' or cr.etat is distinct from 'fermee' then
    raise exception 'Bilan à froid : fermez d''abord les deux questionnaires à froid (stagiaires et établissement).';
  end if;
  select j.detail into dernier from bilans.journal j where j.session_id = p_session and j.evenement = 'froid_envoi' order by j.seq desc limit 1;
  return public.bil_srv_contexte(p_session) || jsonb_build_object(
    'version', (select coalesce(max(version), 0) + 1 from bilans.documents where session_id = p_session and type = 'pdf_froid'),
    'froid', jsonb_build_object(
      'date_limite', to_char(fr.date_limite, 'DD/MM/YYYY'),
      'envoye_le', to_char(fr.envoye_le at time zone 'Europe/Paris', 'DD/MM/YYYY'),
      'm3_envoye_le', to_char(fr.m3_envoye_le at time zone 'Europe/Paris', 'DD/MM/YYYY'),
      'essais', fr.essais,
      'envoyes', (select coalesce(sum((j.detail #>> '{stagiaires,envoyes}')::int), 0) from bilans.journal j
                  where j.session_id = p_session and j.evenement = 'froid_envoi'),
      'restantes', coalesce((dernier #>> '{stagiaires,restantes}')::int, 0),
      'remise', (select j.detail from bilans.journal j where j.session_id = p_session and j.evenement = 'froid_remise' order by j.seq desc limit 1),
      'stagiaires', jsonb_build_object('ouverte_le', to_char(cs.ouverte_le at time zone 'Europe/Paris', 'DD/MM/YYYY'),
                                       'fermee_le', to_char(cs.fermee_le at time zone 'Europe/Paris', 'DD/MM/YYYY')),
      'responsable', jsonb_build_object('ouverte_le', to_char(cr.ouverte_le at time zone 'Europe/Paris', 'DD/MM/YYYY'),
                                        'fermee_le', to_char(cr.fermee_le at time zone 'Europe/Paris', 'DD/MM/YYYY'))));
end $$;

create function public.bil_srv_froid_document(p_session uuid, p_version integer, p_chemin text, p_sha256 text, p_octets integer, p_par text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o bilans.documents;
begin
  insert into bilans.documents (session_id, type, version, chemin, sha256, octets)
  values (p_session, 'pdf_froid', p_version, p_chemin, lower(p_sha256), p_octets) returning * into o;
  perform bilans.noter(p_session, 'froid_pdf_produit', coalesce(p_par, 'serveur'), jsonb_build_object('version', p_version, 'chemin', p_chemin, 'sha256', lower(p_sha256)));
  return to_jsonb(o);
end $$;

create function public.bil_srv_froid_pdf_journal(p_session uuid, p_evenement text, p_detail jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_evenement not in ('froid_pdf_echec', 'froid_pdf_mail_envoye', 'froid_pdf_mail_echec') then raise exception 'Événement serveur inconnu.'; end if;
  perform bilans.noter(p_session, p_evenement, 'serveur', coalesce(p_detail, '{}'));
end $$;

-- ---------------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------------
do $$ declare fn text; begin
  foreach fn in array array['public.bil_froid_bilan_exiger(uuid)', 'public.bil_srv_froid_contexte(uuid)',
                            'public.bil_srv_froid_document(uuid, integer, text, text, integer, text)', 'public.bil_srv_froid_pdf_journal(uuid, text, jsonb)'] loop
    execute 'revoke all on function ' || fn || ' from public';
    begin execute 'revoke all on function ' || fn || ' from anon, authenticated, service_role';
    exception when undefined_object then null; end;
  end loop;
end $$;
grant execute on function public.bil_froid_bilan_exiger(uuid) to authenticated;
grant execute on function public.bil_srv_froid_contexte(uuid) to service_role;
grant execute on function public.bil_srv_froid_document(uuid, integer, text, text, integer, text) to service_role;
grant execute on function public.bil_srv_froid_pdf_journal(uuid, text, jsonb) to service_role;
