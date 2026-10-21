-- Quién hizo la última edición de cada evaluación (#817, RF-1 y D6 del PRD de
-- E31). La lista de Evaluaciones lo enseña junto a la fecha.
--
-- Lo escriben las mismas funciones de `0032_member_evaluation_writes.sql` y
-- `0033_manage_evaluation_categories.sql`, que ahora reciben a quien llama:
-- crear lo apunta, guardar y poner al día lo pasan a quien lo hizo. Las
-- evaluaciones de antes de esta migración se quedan sin nadie, porque no se
-- sabe quién fue y no se inventa.

alter table public.member_evaluations
  add column if not exists updated_by uuid;

-- Compuesta como la del evaluado: quien edita es un miembro del mismo club.
-- Borrar a quien editó no borra la evaluación, sólo lo olvida; la lista de
-- columnas de `set null` deja el `club_id`, que no puede ser nulo.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'member_evaluations_updated_by_same_club_fkey'
  ) then
    alter table public.member_evaluations
      add constraint member_evaluations_updated_by_same_club_fkey
      foreign key (updated_by, club_id)
      references public.members (user_id, club_id)
      on delete set null (updated_by);
  end if;
end;
$$;

-- La que recorre la clave al borrar un miembro.
create index if not exists member_evaluations_updated_by_club_id_idx
  on public.member_evaluations (updated_by, club_id);

-- Una función con otra firma sería otra función: las de antes se quitan para
-- que nadie escriba una evaluación sin decir quién es.
drop function if exists public.create_member_evaluation(uuid, uuid);
drop function if exists
  public.save_member_evaluation_ratings(uuid, uuid, timestamptz, jsonb);
drop function if exists public.refresh_member_evaluation(uuid, uuid);

-- La de `0032`, apuntando a quien la crea.
create or replace function public.create_member_evaluation(
  acting_club_id uuid,
  acting_user_id uuid,
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
  new_evaluation_id uuid;
begin
  member_status := public.lock_evaluated_member(acting_club_id, target_user_id);
  if member_status is null then
    return jsonb_build_object('outcome', 'member_not_found');
  end if;
  if member_status = 'inactive' then
    return jsonb_build_object('outcome', 'member_inactive');
  end if;

  if not exists (
    select 1
      from public.evaluation_categories c
     where c.club_id = acting_club_id
       and c.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'no_active_categories');
  end if;

  insert into public.member_evaluations (user_id, club_id, updated_by)
  values (target_user_id, acting_club_id, acting_user_id)
  on conflict (user_id) do nothing
  returning id into new_evaluation_id;

  if new_evaluation_id is null then
    return jsonb_build_object('outcome', 'already_exists');
  end if;

  insert into public.member_evaluation_ratings
    (evaluation_id, category_id, club_id, rating)
  select new_evaluation_id, c.id, acting_club_id, initial_rating
    from public.evaluation_categories c
   where c.club_id = acting_club_id
     and c.deactivated_at is null;

  return jsonb_build_object('outcome', 'created');
end;
$$;

-- La de `0032`, pasando la evaluación a quien guarda.
create or replace function public.save_member_evaluation_ratings(
  acting_club_id uuid,
  acting_user_id uuid,
  target_user_id uuid,
  expected_updated_at timestamptz,
  ratings jsonb
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  member_status text;
  target_evaluation_id uuid;
  current_updated_at timestamptz;
  foreign_category_id uuid;
begin
  member_status := public.lock_evaluated_member(acting_club_id, target_user_id);
  if member_status is null then
    return jsonb_build_object('outcome', 'member_not_found');
  end if;
  if member_status = 'inactive' then
    return jsonb_build_object('outcome', 'member_inactive');
  end if;

  select e.id, e.updated_at into target_evaluation_id, current_updated_at
    from public.member_evaluations e
   where e.user_id = target_user_id
     and e.club_id = acting_club_id
     for update;

  if target_evaluation_id is null then
    return jsonb_build_object('outcome', 'evaluation_not_found');
  end if;
  if current_updated_at is distinct from expected_updated_at then
    return jsonb_build_object('outcome', 'evaluation_changed');
  end if;

  select (wanted.value ->> 'category_id')::uuid into foreign_category_id
    from jsonb_array_elements(ratings) as wanted (value)
   where not exists (
     select 1
       from public.member_evaluation_ratings r
      where r.evaluation_id = target_evaluation_id
        and r.category_id = (wanted.value ->> 'category_id')::uuid
   )
   limit 1;

  if foreign_category_id is not null then
    return jsonb_build_object(
      'outcome', 'unknown_category',
      'category_id', foreign_category_id
    );
  end if;

  update public.member_evaluation_ratings r
     set rating = (wanted.value ->> 'rating')::numeric
    from jsonb_array_elements(ratings) as wanted (value)
   where r.evaluation_id = target_evaluation_id
     and r.category_id = (wanted.value ->> 'category_id')::uuid;

  update public.member_evaluations e
     set updated_at = now(),
         updated_by = acting_user_id
   where e.id = target_evaluation_id;

  return jsonb_build_object('outcome', 'saved');
end;
$$;

-- La de `0033`, pasando la evaluación a quien la pone al día. Si ya estaba al
-- día no se toca nada, tampoco quién la editó.
create or replace function public.refresh_member_evaluation(
  acting_club_id uuid,
  acting_user_id uuid,
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
     set updated_at = now(),
         updated_by = acting_user_id
   where e.id = target_evaluation_id;

  return jsonb_build_object(
    'outcome', 'refreshed',
    'added_count', added_count,
    'removed_count', removed_count
  );
end;
$$;

-- Abiertas a `authenticated`, cualquier miembro podría escribir notas
-- llamándolas por PostgREST, que es justo lo que FR-055 prohíbe.
revoke all on function public.create_member_evaluation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_member_evaluation(uuid, uuid, uuid)
  to service_role;

revoke all on function
  public.save_member_evaluation_ratings(uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.save_member_evaluation_ratings(uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;

revoke all on function public.refresh_member_evaluation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_member_evaluation(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
