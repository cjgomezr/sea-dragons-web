-- El Admin administra las posiciones del club (#300, RF-7 del PRD de E18a):
-- crea, renombra, reordena, archiva y reactiva, sin tocar la base a mano.
--
-- Cada cambio va en una función porque toca varias filas a la vez. Crear es la
-- posición y sus nombres; renombrar puede quitar el nombre de un idioma y
-- poner el del otro; reordenar reescribe el orden de todas. Hecho desde la
-- aplicación con escrituras sueltas, un fallo a medias dejaría una posición
-- sin ningún nombre, y la lectura del catálogo (`supabase-club-positions.ts`)
-- se niega a servirla: el perfil y el directorio dejarían de cargar.
--
-- Las cuatro bloquean las posiciones del club antes de mirar nada, en el mismo
-- orden. Así dos Admin que guardan a la vez se esperan, y el segundo ve lo que
-- dejó el primero: el nombre repetido se detecta aquí y no sólo en el índice
-- único de `0025`, que respondería con un error sin decir en qué idioma.
--
-- Archivar sigue siendo una fecha (D3 del PRD): nadie pierde la posición que
-- tenía. Ninguna función toca `members`.
--
-- `security definer` y sólo `service_role`, como `set_member_status` (`0017`):
-- el servidor ya comprobó que quien llama es Admin y pasa su club. La
-- bitácora no se escribe aquí: su único camino es `recordAuditEvent`
-- (NFR-010).

-- El bloqueo que comparten las cuatro.
create or replace function public.lock_club_positions(acting_club_id uuid)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform 1
     from public.club_positions p
    where p.club_id = acting_club_id
    order by p.id
      for update;
end;
$$;

-- El idioma cuyo nombre ya usa otra posición del club, o null si ninguno. Con
-- la misma comparación que el índice único de `0025`: sin distinguir
-- mayúsculas ni espacios de los extremos.
create or replace function public.club_position_name_taken(
  acting_club_id uuid,
  own_position_id uuid,
  name_en text,
  name_es text
)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select n.locale
    from public.club_position_names n
    join (values ('en', name_en), ('es', name_es)) as wanted (locale, name)
      on wanted.locale = n.locale
   where n.club_id = acting_club_id
     and wanted.name is not null
     and lower(btrim(n.name)) = lower(btrim(wanted.name))
     and n.position_id is distinct from own_position_id
   order by n.locale
   limit 1;
$$;

create or replace function public.insert_club_position_names(
  acting_club_id uuid,
  target_position_id uuid,
  name_en text,
  name_es text
)
  returns void
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  insert into public.club_position_names (position_id, club_id, locale, name)
  select target_position_id, acting_club_id, wanted.locale, wanted.name
    from (values ('en', name_en), ('es', name_es)) as wanted (locale, name)
   where wanted.name is not null;
$$;

create or replace function public.create_club_position(
  acting_club_id uuid,
  name_en text,
  name_es text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  taken_locale text;
  new_position_id uuid;
begin
  if name_en is null and name_es is null then
    raise exception 'la posición necesita un nombre en algún idioma'
      using errcode = 'invalid_parameter_value';
  end if;

  perform public.lock_club_positions(acting_club_id);

  taken_locale := public.club_position_name_taken(
    acting_club_id, null, name_en, name_es
  );
  if taken_locale is not null then
    return jsonb_build_object('outcome', 'name_taken', 'locale', taken_locale);
  end if;

  -- Al final de todas, archivadas incluidas: así también queda detrás de las
  -- activas.
  insert into public.club_positions (club_id, sort_order)
  select acting_club_id, coalesce(max(p.sort_order), 0) + 1
    from public.club_positions p
   where p.club_id = acting_club_id
  returning id into new_position_id;

  perform public.insert_club_position_names(
    acting_club_id, new_position_id, name_en, name_es
  );

  return jsonb_build_object(
    'outcome', 'created',
    'position_id', new_position_id
  );
end;
$$;

-- El idioma que llega en blanco pierde su nombre: la lectura cae al otro (D2
-- del PRD). Quien la tenía la sigue teniendo, porque `members` apunta al id.
create or replace function public.rename_club_position(
  acting_club_id uuid,
  target_position_id uuid,
  name_en text,
  name_es text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  taken_locale text;
begin
  if name_en is null and name_es is null then
    raise exception 'la posición necesita un nombre en algún idioma'
      using errcode = 'invalid_parameter_value';
  end if;

  perform public.lock_club_positions(acting_club_id);

  -- La de otro club responde igual que una que no existe.
  if not exists (
    select 1
      from public.club_positions p
     where p.id = target_position_id
       and p.club_id = acting_club_id
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  taken_locale := public.club_position_name_taken(
    acting_club_id, target_position_id, name_en, name_es
  );
  if taken_locale is not null then
    return jsonb_build_object('outcome', 'name_taken', 'locale', taken_locale);
  end if;

  delete from public.club_position_names n
   where n.position_id = target_position_id;

  perform public.insert_club_position_names(
    acting_club_id, target_position_id, name_en, name_es
  );

  return jsonb_build_object('outcome', 'renamed');
end;
$$;

-- `ordered_ids` son las activas del club, todas y una vez cada una, en el
-- orden nuevo. Si no casa, otro Admin creó, archivó o reactivó una
-- entretanto, y reordenar a ciegas dejaría alguna fuera de su sitio. Las
-- archivadas conservan su número: al reactivarse vuelven al final.
create or replace function public.reorder_club_positions(
  acting_club_id uuid,
  ordered_ids uuid[]
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform public.lock_club_positions(acting_club_id);

  if cardinality(ordered_ids) is distinct from (
       select count(distinct wanted.id) from unnest(ordered_ids) as wanted (id)
     )
     or exists (
       select p.id
         from public.club_positions p
        where p.club_id = acting_club_id
          and p.archived_at is null
       except
       select wanted.id from unnest(ordered_ids) as wanted (id)
     )
     or exists (
       select wanted.id from unnest(ordered_ids) as wanted (id)
       except
       select p.id
         from public.club_positions p
        where p.club_id = acting_club_id
          and p.archived_at is null
     ) then
    return jsonb_build_object('outcome', 'positions_changed');
  end if;

  update public.club_positions p
     set sort_order = wanted.rank
    from unnest(ordered_ids) with ordinality as wanted (id, rank)
   where p.id = wanted.id
     and p.club_id = acting_club_id;

  return jsonb_build_object('outcome', 'reordered');
end;
$$;

create or replace function public.set_club_position_archived(
  acting_club_id uuid,
  target_position_id uuid,
  archived boolean
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  was_archived boolean;
begin
  if archived is null then
    raise exception 'falta decir si la posición queda archivada'
      using errcode = 'invalid_parameter_value';
  end if;

  perform public.lock_club_positions(acting_club_id);

  select p.archived_at is not null into was_archived
    from public.club_positions p
   where p.id = target_position_id
     and p.club_id = acting_club_id;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if was_archived = archived then
    return jsonb_build_object('outcome', 'unchanged');
  end if;

  if archived then
    update public.club_positions
       set archived_at = now()
     where id = target_position_id;
  else
    -- Vuelve detrás de las activas, no al hueco que dejó: el Admin la ve
    -- aparecer al final y la mueve si quiere.
    update public.club_positions
       set archived_at = null,
           sort_order = (
             select coalesce(max(p.sort_order), 0) + 1
               from public.club_positions p
              where p.club_id = acting_club_id
           )
     where id = target_position_id;
  end if;

  return jsonb_build_object('outcome', 'changed');
end;
$$;

-- Abiertas a `authenticated`, cualquier miembro podría cambiar el catálogo de
-- su club llamándolas por PostgREST.
revoke all on function public.lock_club_positions(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.club_position_name_taken(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.insert_club_position_names(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_club_position(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_club_position(uuid, text, text)
  to service_role;

revoke all on function public.rename_club_position(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rename_club_position(uuid, uuid, text, text)
  to service_role;

revoke all on function public.reorder_club_positions(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.reorder_club_positions(uuid, uuid[])
  to service_role;

revoke all on function public.set_club_position_archived(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_club_position_archived(uuid, uuid, boolean)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las funciones en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
