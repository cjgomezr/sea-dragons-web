-- Cada socio lee sólo los ciclos activos que le tocan (issue #979, D4 y D5
-- de `docs/prd/e38-ciclos-por-grupo.md`): los de todo el club y los de sus
-- grupos, si está al día. Quien planifica lee todos. Hasta aquí `0083`
-- dejaba leer cualquier activo a quien tenía acceso al entrenamiento.
--
-- Semanas, días y rutinas del ciclo ya se leen con su subconsulta sobre
-- `training_cycles`, así que heredan la regla sin tocarlas.
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `create or replace` o `drop ... if exists`.

-- Si quien pregunta está en algún grupo del ciclo. `security definer` porque
-- la policy de `training_cycle_groups` lee `training_cycles`, y leer aquí
-- `training_cycle_groups` con RLS cerraría el círculo entre las dos
-- policies. Responde sólo por quien pregunta.
create or replace function public.is_in_training_cycle_groups(
  target_cycle_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.training_cycle_groups cg
      join public.group_memberships gm
        on gm.group_id = cg.group_id
       and gm.club_id = cg.club_id
     where cg.cycle_id = target_cycle_id
       and gm.user_id = (select auth.uid())
  )
$$;

revoke all on function public.is_in_training_cycle_groups(uuid)
  from public, anon;
grant execute on function public.is_in_training_cycle_groups(uuid)
  to authenticated, service_role;

-- El activo de todo el club o de un grupo suyo, quien está al día (D4);
-- todos, quien planifica (D5).
drop policy if exists training_cycles_select on public.training_cycles;
create policy training_cycles_select
  on public.training_cycles
  for select
  to authenticated
  using (
    (
      status = 'active'
      and public.has_training_access(club_id)
      and (
        audience = 'club'
        or public.is_in_training_cycle_groups(id)
      )
    )
    or public.is_training_planner(club_id)
  );

-- Los grupos de los ciclos que ve: la subconsulta pasa por la policy de
-- arriba. La de quien planifica (`0095`) se queda: es la misma regla para él.
drop policy if exists training_cycle_groups_select_member
  on public.training_cycle_groups;
create policy training_cycle_groups_select_member
  on public.training_cycle_groups
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.training_cycles c
       where c.id = training_cycle_groups.cycle_id
    )
  );
