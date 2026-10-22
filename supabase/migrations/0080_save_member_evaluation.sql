-- Guardar una evaluación la pone al día (#820, D4 del PRD de E31). En la
-- edición se ven las categorías activas del club: las que ya tenía con su
-- nota y las nuevas en 5. Guardar aplica en una sola escritura la puesta al
-- día de `refresh_member_evaluation` y las notas, contra la fecha que se
-- leyó: si alguien guardó entretanto no se toca nada, tampoco la puesta al
-- día.
--
-- Es una función nueva y no un cambio de `save_member_evaluation_ratings`:
-- aquélla rechaza a propósito una categoría que la evaluación no tiene
-- (AC-035 de E9) y se queda como estaba. Ésta acepta cualquier categoría
-- activa del club y rechaza todo lo demás, también una que se desactivó
-- mientras se editaba: ignorarla perdería sin decirlo la nota que se movió.

create or replace function public.save_member_evaluation(
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
  initial_rating constant numeric := 5;
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

  -- Después del miembro, como `refresh_member_evaluation`: el catálogo no
  -- cambia de activas a mitad de la escritura.
  perform public.lock_evaluation_categories(acting_club_id);

  select (wanted.value ->> 'category_id')::uuid into foreign_category_id
    from jsonb_array_elements(ratings) as wanted (value)
   where not exists (
     select 1
       from public.evaluation_categories c
      where c.id = (wanted.value ->> 'category_id')::uuid
        and c.club_id = acting_club_id
        and c.deactivated_at is null
   )
   limit 1;

  if foreign_category_id is not null then
    return jsonb_build_object(
      'outcome', 'unknown_category',
      'category_id', foreign_category_id
    );
  end if;

  delete from public.member_evaluation_ratings r
   using public.evaluation_categories c
   where r.evaluation_id = target_evaluation_id
     and c.id = r.category_id
     and c.deactivated_at is not null;

  -- Las que llegan, y en 5 las activas que le faltaban y no llegan.
  insert into public.member_evaluation_ratings
    (evaluation_id, category_id, club_id, rating)
  select target_evaluation_id, c.id, acting_club_id,
         coalesce(
           (
             select (wanted.value ->> 'rating')::numeric
               from jsonb_array_elements(ratings) as wanted (value)
              where (wanted.value ->> 'category_id')::uuid = c.id
           ),
           initial_rating
         )
    from public.evaluation_categories c
   where c.club_id = acting_club_id
     and c.deactivated_at is null
  on conflict (evaluation_id, category_id) do update
     set rating = excluded.rating
   where exists (
     select 1
       from jsonb_array_elements(ratings) as wanted (value)
      where (wanted.value ->> 'category_id')::uuid = excluded.category_id
   );

  update public.member_evaluations e
     set updated_at = now(),
         updated_by = acting_user_id
   where e.id = target_evaluation_id;

  return jsonb_build_object('outcome', 'saved');
end;
$$;

-- Abierta a `authenticated`, cualquier miembro podría escribir notas
-- llamándola por PostgREST, que es justo lo que FR-055 prohíbe.
revoke all on function
  public.save_member_evaluation(uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.save_member_evaluation(uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;

notify pgrst, 'reload schema';
