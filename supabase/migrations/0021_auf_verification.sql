-- La verificación del registro federativo (AUF) de un socio (#274, RF-12 del
-- PRD de E5).
--
-- Hasta este ticket sólo un Admin escribía el AUF (decisión B3 de
-- docs/preguntas-abiertas.md). Desde el 22 de septiembre de 2026 el propio
-- miembro puede escribirlo, pero BR-008 pide poder fiarse del dato: lo que
-- escribe el miembro queda sin verificar hasta que un Admin lo confirme.
--
-- `auf_verified_at` es esa marca: null es sin verificar, un instante es desde
-- cuándo está verificado. Quién lo verificó lo guarda la bitácora
-- (`member.auf_verified`), que ya lleva el actor y la hora; una columna más
-- sólo lo repetiría.
--
-- Sin privilegios ni policies nuevas: `0003_members.sql` deja a
-- `authenticated` leer sólo su fila y no escribir nada, y los `grant` son de
-- tabla. Quién pone y quién quita la marca lo decide la API con la llave de
-- servicio.

-- El relleno va dentro del mismo `if` que crea la columna, y eso es lo que lo
-- hace idempotente. Un `where auf_verified_at is null` no bastaría: en la
-- segunda corrida verificaría también los AUF que un miembro escribió después
-- de la primera, que son justo los que un Admin aún no ha mirado.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'members'
       and column_name = 'auf_verified_at'
  ) then
    alter table public.members add column auf_verified_at timestamptz;

    -- Hasta hoy los escribía un Admin: ya están verificados.
    update public.members
       set auf_verified_at = now()
     where auf_number is not null;
  end if;
end
$$;

-- Verificado sin número no significa nada: quitar el registro quita también
-- su verificación.
alter table public.members
  drop constraint if exists members_auf_verified_requires_number;
alter table public.members
  add constraint members_auf_verified_requires_number check (
    auf_verified_at is null or auf_number is not null
  );
