-- La aplicación pasa a escribir `members.position_id` (#299, RF-7 del PRD de
-- E18a): el perfil y el alta eligen una posición del catálogo del club, no una
-- grafía de texto.
--
-- El trigger de `0025` resolvía `members.position` a la referencia en cada
-- alta, y con el texto en blanco dejaba la referencia en blanco. Un alta que
-- sólo trae `position_id` perdía así la posición elegida sin ningún error.
-- Ahora un alta sin texto conserva la referencia que trae.
--
-- La columna de texto y el trigger se quedan por ahora, a propósito: retirarlos
-- en `seadragons-dev` antes de fusionar este cambio rompería el código de
-- `main`, que todavía la lee y la escribe, en cada rama que se prueba contra
-- esa base. Desde aquí la columna ya no se mantiene al día, y nadie la lee.

create or replace function public.members_sync_position_id()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.position is null then
    -- Borrar el texto con un `update` sigue quitando la posición, como en
    -- `0025`. Un alta sin texto es la aplicación escribiendo la referencia.
    if tg_op = 'UPDATE' then
      new.position_id := null;
    end if;
    return new;
  end if;

  select n.position_id
    into new.position_id
    from public.club_position_names n
   where n.club_id = new.club_id
     and n.locale = 'en'
     and n.name = new.position;

  if new.position_id is null then
    raise exception
      'new row for relation "members" violates check constraint "members_position_check"'
      using errcode = 'check_violation',
            constraint = 'members_position_check',
            detail = format('El club %s no tiene la posición %L.',
                            new.club_id, new.position);
  end if;
  return new;
end
$$;

-- `create or replace` conserva los privilegios, pero se repite para que la
-- migración diga por sí sola que el trigger no se llama a mano.
revoke all on function public.members_sync_position_id()
  from public, anon, authenticated;

comment on column public.members.position is
  'Obsoleta desde 0026 (#299): la posición es position_id. No se mantiene al día.';
