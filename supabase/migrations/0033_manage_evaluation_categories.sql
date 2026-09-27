-- El club configura qué mide (#320, RF-3 y RF-4 del PRD de E9): añade,
-- renombra, reordena, desactiva y reactiva sus categorías, y pone al día una
-- evaluación vieja cuando alguien lo pide.
--
-- Es el mismo problema que las posiciones de E18a y sigue el patrón de
-- `0027_manage_club_positions.sql`: cada cambio en una función que bloquea el
-- catálogo del club antes de mirar nada, así dos personas que guardan a la vez
-- se esperan y la segunda ve el nombre que dejó la primera.
--
-- Ninguna función del catálogo toca `member_evaluation_ratings`: una
-- evaluación guardada conserva su conjunto (AC-035). Lo único que la cambia es
-- `refresh_member_evaluation`, que es una acción explícita (FR-053).
--
-- `security definer` y sólo `service_role`, como `0032`: el servidor ya
-- comprobó que quien llama es Admin o Coach y pasa su club. La bitácora no se
-- escribe aquí: su único camino es `recordAuditEvent` (NFR-010).

-- Primero la fila del club: uno sin ninguna categoría no tendría nada más que
-- bloquear, y dos altas simultáneas de la primera no se esperarían.
create or replace function public.lock_evaluation_categories(
  acting_club_id uuid
)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform 1 from public.clubs c where c.id = acting_club_id for update;

  perform 1
     from public.evaluation_categories e
    where e.club_id = acting_club_id
    order by e.id
      for update;
end;
$$;

-- Con la misma comparación que el índice único de `0031`: sin distinguir
-- mayúsculas ni espacios de los extremos, y contando las desactivadas.
create or replace function public.evaluation_category_name_taken(
  acting_club_id uuid,
  own_category_id uuid,
  category_name text
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.evaluation_categories e
     where e.club_id = acting_club_id
       and lower(btrim(e.name)) = lower(btrim(category_name))
       and e.id is distinct from own_category_id
  );
$$;

create or replace function public.create_evaluation_category(
  acting_club_id uuid,
  category_name text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  new_category_id uuid;
begin
  perform public.lock_evaluation_categories(acting_club_id);

  if public.evaluation_category_name_taken(
       acting_club_id, null, category_name
     ) then
    return jsonb_build_object('outcome', 'name_taken');
  end if;

  -- Al final de todas, desactivadas incluidas: así también queda detrás de
  -- las activas.
  insert into public.evaluation_categories (club_id, name, sort_order)
  select acting_club_id, btrim(category_name), coalesce(max(e.sort_order), 0) + 1
    from public.evaluation_categories e
   where e.club_id = acting_club_id
  returning id into new_category_id;

  return jsonb_build_object(
    'outcome', 'created',
    'category_id', new_category_id
  );
end;
$$;

-- Las valoraciones apuntan a la categoría por su id: el nombre nuevo se ve en
-- todas las evaluaciones que la usan sin tocar ninguna.
create or replace function public.rename_evaluation_category(
  acting_club_id uuid,
  target_category_id uuid,
  category_name text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform public.lock_evaluation_categories(acting_club_id);

  -- La de otro club responde igual que una que no existe.
  if not exists (
    select 1
      from public.evaluation_categories e
     where e.id = target_category_id
       and e.club_id = acting_club_id
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.evaluation_category_name_taken(
       acting_club_id, target_category_id, category_name
     ) then
    return jsonb_build_object('outcome', 'name_taken');
  end if;

  update public.evaluation_categories
     set name = btrim(category_name)
   where id = target_category_id;

  return jsonb_build_object('outcome', 'renamed');
end;
$$;

-- `ordered_ids` son las activas del club, todas y una vez cada una, en el
-- orden nuevo. Si no casa, alguien creó, desactivó o reactivó una entretanto.
-- Las desactivadas conservan su número: al reactivarse vuelven al final.
create or replace function public.reorder_evaluation_categories(
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
  perform public.lock_evaluation_categories(acting_club_id);

  if cardinality(ordered_ids) is distinct from (
       select count(distinct wanted.id) from unnest(ordered_ids) as wanted (id)
     )
     or exists (
       select e.id
         from public.evaluation_categories e
        where e.club_id = acting_club_id
          and e.deactivated_at is null
       except
       select wanted.id from unnest(ordered_ids) as wanted (id)
     )
     or exists (
       select wanted.id from unnest(ordered_ids) as wanted (id)
       except
       select e.id
         from public.evaluation_categories e
        where e.club_id = acting_club_id
          and e.deactivated_at is null
     ) then
    return jsonb_build_object('outcome', 'categories_changed');
  end if;

  update public.evaluation_categories e
     set sort_order = wanted.rank
    from unnest(ordered_ids) with ordinality as wanted (id, rank)
   where e.id = wanted.id
     and e.club_id = acting_club_id;

  return jsonb_build_object('outcome', 'reordered');
end;
$$;

create or replace function public.set_evaluation_category_active(
  acting_club_id uuid,
  target_category_id uuid,
  active boolean
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  was_active boolean;
begin
  if active is null then
    raise exception 'falta decir si la categoría queda activa'
      using errcode = 'invalid_parameter_value';
  end if;

  perform public.lock_evaluation_categories(acting_club_id);

  select e.deactivated_at is null into was_active
    from public.evaluation_categories e
   where e.id = target_category_id
     and e.club_id = acting_club_id;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if was_active = active then
    return jsonb_build_object('outcome', 'unchanged');
  end if;

  if active then
    -- Vuelve detrás de las activas, no al hueco que dejó, como las posiciones.
    update public.evaluation_categories
       set deactivated_at = null,
           sort_order = (
             select coalesce(max(e.sort_order), 0) + 1
               from public.evaluation_categories e
              where e.club_id = acting_club_id
           )
     where id = target_category_id;
  else
    update public.evaluation_categories
       set deactivated_at = now()
     where id = target_category_id;
  end if;

  return jsonb_build_object('outcome', 'changed');
end;
$$;

-- Lleva una evaluación al conjunto activo del club (FR-053, AC-054): las
-- categorías que le faltan entran en 5, las desactivadas salen con su
-- valoración, y las que siguen conservan la suya. Si ya estaba al día no se
-- toca nada, ni la fecha: nadie que la tenga abierta pierde su guardado.
--
-- Con el club sin categorías activas no se hace nada: la dejaría vacía, y la
-- valoración de las que salen no se recupera.
create or replace function public.refresh_member_evaluation(
  acting_club_id uuid,
  target_user_id uuid
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  initial_rating constant numeric := 5;
  member_status text;
  target_evaluation_id uuid;
  removed_count integer;
  added_count integer;
begin
  member_status := public.lock_evaluated_member(acting_club_id, target_user_id);
  if member_status is null then
    return jsonb_build_object('outcome', 'member_not_found');
  end if;
  if member_status = 'inactive' then
    return jsonb_build_object('outcome', 'member_inactive');
  end if;

  select e.id into target_evaluation_id
    from public.member_evaluations e
   where e.user_id = target_user_id
     and e.club_id = acting_club_id
     for update;

  if target_evaluation_id is null then
    return jsonb_build_object('outcome', 'evaluation_not_found');
  end if;

  -- Después del miembro, como en todas las escrituras de evaluaciones: las
  -- funciones del catálogo no bloquean miembros, así que el orden no cruza.
  perform public.lock_evaluation_categories(acting_club_id);

  if not exists (
    select 1
      from public.evaluation_categories c
     where c.club_id = acting_club_id
       and c.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'no_active_categories');
  end if;

  delete from public.member_evaluation_ratings r
   using public.evaluation_categories c
   where r.evaluation_id = target_evaluation_id
     and c.id = r.category_id
     and c.deactivated_at is not null;
  get diagnostics removed_count = row_count;

  insert into public.member_evaluation_ratings
    (evaluation_id, category_id, club_id, rating)
  select target_evaluation_id, c.id, acting_club_id, initial_rating
    from public.evaluation_categories c
   where c.club_id = acting_club_id
     and c.deactivated_at is null
     and not exists (
       select 1
         from public.member_evaluation_ratings r
        where r.evaluation_id = target_evaluation_id
          and r.category_id = c.id
     );
  get diagnostics added_count = row_count;

  if removed_count = 0 and added_count = 0 then
    return jsonb_build_object('outcome', 'already_current');
  end if;

  update public.member_evaluations e
     set updated_at = now()
   where e.id = target_evaluation_id;

  return jsonb_build_object(
    'outcome', 'refreshed',
    'added_count', added_count,
    'removed_count', removed_count
  );
end;
$$;

-- Abiertas a `authenticated`, cualquier miembro podría cambiar lo que mide el
-- club, o las evaluaciones, llamándolas por PostgREST (FR-055).
revoke all on function public.lock_evaluation_categories(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.evaluation_category_name_taken(uuid, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_evaluation_category(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_evaluation_category(uuid, text)
  to service_role;

revoke all on function public.rename_evaluation_category(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rename_evaluation_category(uuid, uuid, text)
  to service_role;

revoke all on function public.reorder_evaluation_categories(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.reorder_evaluation_categories(uuid, uuid[])
  to service_role;

revoke all on function
  public.set_evaluation_category_active(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.set_evaluation_category_active(uuid, uuid, boolean)
  to service_role;

revoke all on function public.refresh_member_evaluation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_member_evaluation(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
