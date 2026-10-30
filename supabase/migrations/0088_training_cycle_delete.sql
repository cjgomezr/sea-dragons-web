-- Planificar: borrar un ciclo en borrador o archivado (issue #935, E35). El
-- activo es el que siguen los socios esa semana y no se borra nunca: primero
-- se archiva. Mirar el estado y borrar van en la misma transacción, con el
-- ciclo bloqueado, para que una activación a la vez no se cuele entre los
-- dos. Lo llama el servidor con la llave de servicio (D4); no es para una
-- sesión.
--
-- Las `on delete cascade` de `0083` se llevan las semanas, los días y las
-- rutinas propias (`cycle_id` del ciclo) con sus filas. Las compartidas
-- tienen `cycle_id` nulo y no se tocan, ni los ejercicios ni las marcas.
--
-- Producción reaplica el histórico entero en cada merge: `create or replace`.

-- Sin filas si el ciclo no es del club. Con el activo, `deleted` es falso y
-- no se borra nada.
create or replace function public.delete_training_cycle(
  p_club_id uuid,
  p_cycle_id uuid
)
  returns table (
    deleted boolean,
    previous_status text,
    routines_deleted integer
  )
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_status text;
begin
  select c.status
    into v_status
    from public.training_cycles c
   where c.id = p_cycle_id
     and c.club_id = p_club_id
     for update;
  if not found then
    return;
  end if;

  previous_status := v_status;
  if v_status = 'active' then
    deleted := false;
    routines_deleted := 0;
    return next;
    return;
  end if;

  select count(*)::integer
    into routines_deleted
    from public.training_routines r
   where r.cycle_id = p_cycle_id;

  delete from public.training_cycles c
   where c.id = p_cycle_id;

  deleted := true;
  return next;
end;
$$;

revoke all on function public.delete_training_cycle(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_training_cycle(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
