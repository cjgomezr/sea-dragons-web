-- Crear la evaluación de un miembro y guardar sus valoraciones (#319, RF-1
-- del PRD de E9).
--
-- Las dos van en una función porque tocan varias filas a la vez. Crear es la
-- evaluación y una valoración por cada categoría activa; guardar son varias
-- valoraciones y la fecha que hace de versión. Hecho con escrituras sueltas,
-- un fallo a medias dejaría una evaluación sin categorías o con la mitad de
-- los cambios.
--
-- Las dos bloquean la fila del miembro antes de mirar su estado: una baja que
-- llega a la vez espera, y no se evalúa a quien ya está de baja (el mismo
-- criterio que el resto de escrituras sobre inactivos).
--
-- `security definer` y sólo `service_role`, como `0027`: el servidor ya
-- comprobó que quien llama es Admin o Coach (FR-055) y pasa su club. La
-- bitácora no se escribe aquí: su único camino es `recordAuditEvent`
-- (NFR-010).

-- El estado del miembro en el club que actúa, con su fila bloqueada, o null
-- si no es de ese club.
create or replace function public.lock_evaluated_member(
  acting_club_id uuid,
  target_user_id uuid
)
  returns text
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select m.account_status
    from public.members m
   where m.user_id = target_user_id
     and m.club_id = acting_club_id
     for update;
$$;

-- Nace con todas las categorías activas del club en 5 (FR-051). Dos altas a la
-- vez chocan con `member_evaluations_user_id_key`, y la segunda lo dice en vez
-- de fallar.
create or replace function public.create_member_evaluation(
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

  insert into public.member_evaluations (user_id, club_id)
  values (target_user_id, acting_club_id)
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

-- `ratings` es una lista de `{ category_id, rating }`. Sólo se aplica si la
-- evaluación sigue en `expected_updated_at`, que es la que tenía delante
-- quien guarda: si alguien guardó entretanto, no se pisa nada (RF-1).
--
-- Sólo valen las categorías que la evaluación ya tiene. Editar no migra
-- (RF-4): una categoría añadida después, o de otro club, se rechaza entera,
-- sin escribir las demás. Una valoración fuera de 1 a 10 la rechaza el
-- `check` de `0031`, y el error deshace la función entera.
create or replace function public.save_member_evaluation_ratings(
  acting_club_id uuid,
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
     set updated_at = now()
   where e.id = target_evaluation_id;

  return jsonb_build_object('outcome', 'saved');
end;
$$;

-- Abiertas a `authenticated`, cualquier miembro podría escribir notas
-- llamándolas por PostgREST, que es justo lo que FR-055 prohíbe.
revoke all on function public.lock_evaluated_member(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_member_evaluation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_member_evaluation(uuid, uuid)
  to service_role;

revoke all on function
  public.save_member_evaluation_ratings(uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.save_member_evaluation_ratings(uuid, uuid, timestamptz, jsonb)
  to service_role;

notify pgrst, 'reload schema';
