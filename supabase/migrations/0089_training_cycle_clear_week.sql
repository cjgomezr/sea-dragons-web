-- Vaciar una semana de un ciclo (#943, E35): sus siete días vuelven a
-- descanso y su nota y su dosis se van, sin mover las demás semanas ni
-- tocar el ciclo ni sus rutinas. Las dos tablas en una sola llamada para que
-- no quede la semana a medias. Que la semana exista en el ciclo lo decide la
-- API.
create or replace function public.clear_training_cycle_week(
  p_club_id uuid,
  p_cycle_id uuid,
  p_week_no integer
)
  returns void
  language sql
  security invoker
  set search_path = ''
as $$
  delete from public.training_cycle_days d
   where d.club_id = p_club_id
     and d.cycle_id = p_cycle_id
     and d.week_no = p_week_no;

  delete from public.training_cycle_weeks w
   where w.club_id = p_club_id
     and w.cycle_id = p_cycle_id
     and w.week_no = p_week_no;
$$;

revoke all on function public.clear_training_cycle_week(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.clear_training_cycle_week(uuid, uuid, integer)
  to service_role;

notify pgrst, 'reload schema';
