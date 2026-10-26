-- El mínimo por equipo y la abreviatura por idioma de cada posición (#885,
-- RF-1 y D1, D4, D6, D9 y D10 del PRD de E34). El rol fijo de tres
-- (`coverage`, `0046`) pasa a ser un número que el Admin decide: cuántos de
-- esa posición necesita cada equipo, de 0 a 20. La abreviatura es la que
-- pintan las fichas del team builder, una por idioma como el nombre.
--
-- Todavía no los usa nadie: el auto-balance (#886) y las pantallas (#887,
-- #888) vienen después. El rol se queda hasta #889.

-- La columna, su `check` y el relleno desde el rol van juntos y sólo la
-- primera vez, como en `0046`: producción reaplica el histórico en cada
-- merge, y un relleno fuera del guardia devolvería 1 a lo que el Admin dejó
-- en 0.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'club_positions'
       and column_name = 'min_per_team'
  ) then
    alter table public.club_positions
      add column min_per_team smallint not null default 0
      constraint club_positions_min_per_team_check
      check (min_per_team between 0 and 20);

    update public.club_positions
       set min_per_team = 1
     where coverage is not null;
  end if;
end;
$$;

-- Nula es "sin abreviatura en este idioma". Se mide recortada, como el
-- nombre: sólo espacios no es una abreviatura.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'club_position_names'
       and column_name = 'short_name'
  ) then
    alter table public.club_position_names
      add column short_name text
      constraint club_position_names_short_name_length
      check (char_length(btrim(short_name)) between 1 and 4);

    update public.club_position_names n
       set short_name = abbreviation.short_name
      from public.club_positions p,
           (values
             ('goalkeeper', 'en', 'GK'),
             ('goalkeeper', 'es', 'POR'),
             ('defender', 'en', 'DEF'),
             ('defender', 'es', 'DEF'),
             ('forward', 'en', 'ATT'),
             ('forward', 'es', 'ATA')
           ) as abbreviation (coverage, locale, short_name)
     where p.id = n.position_id
       and p.coverage = abbreviation.coverage
       and n.locale = abbreviation.locale;
  end if;
end;
$$;

-- La siembra de `0046` para los clubes nuevos, ahora con el mínimo y las
-- abreviaturas.
create or replace function public.clubs_seed_default_positions()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  seeded record;
begin
  for seeded in
    with seed (
      sort_order, name_en, name_es, coverage, short_name_en, short_name_es
    ) as (
      values
        (1, 'Goalkeeper', 'Portería', 'goalkeeper', 'GK', 'POR'),
        (2, 'Defender', 'Defensa', 'defender', 'DEF', 'DEF'),
        (3, 'Forward', 'Ataque', 'forward', 'ATT', 'ATA')
    ),
    inserted as (
      insert into public.club_positions
        (club_id, sort_order, coverage, min_per_team)
      select new.id, s.sort_order, s.coverage, 1 from seed s
      returning id, sort_order
    )
    select i.id, s.name_en, s.name_es, s.short_name_en, s.short_name_es
      from inserted i
      join seed s on s.sort_order = i.sort_order
  loop
    insert into public.club_position_names
      (position_id, club_id, locale, name, short_name)
    values
      (seeded.id, new.id, 'en', seeded.name_en, seeded.short_name_en),
      (seeded.id, new.id, 'es', seeded.name_es, seeded.short_name_es);
  end loop;
  return new;
end;
$$;

revoke all on function public.clubs_seed_default_positions()
  from public, anon, authenticated;

-- Renombrar ya no borra y vuelve a insertar los nombres (`0027`): se
-- llevaría las abreviaturas. Ahora cambia el nombre de los idiomas que
-- siguen, añade los que llegan y quita los que se quedan en blanco, que se
-- llevan su abreviatura con ellos.
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
   where n.position_id = target_position_id
     and ((n.locale = 'en' and name_en is null)
       or (n.locale = 'es' and name_es is null));

  insert into public.club_position_names (position_id, club_id, locale, name)
  select target_position_id, acting_club_id, wanted.locale, wanted.name
    from (values ('en', name_en), ('es', name_es)) as wanted (locale, name)
   where wanted.name is not null
  on conflict (position_id, locale) do update set name = excluded.name;

  return jsonb_build_object('outcome', 'renamed');
end;
$$;

-- `create or replace` conserva los permisos de `0027`; repetirlos aquí no
-- depende de eso.
revoke all on function public.rename_club_position(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rename_club_position(uuid, uuid, text, text)
  to service_role;

-- El mínimo nuevo de una posición del club. Devuelve el anterior para la
-- bitácora, leído bajo el mismo bloqueo que la escritura: dos Admin a la vez
-- no anotan el mismo valor de partida. Una archivada lo guarda igual (D9): no
-- exige mientras lo esté, pero lo conserva para cuando vuelva.
create or replace function public.set_club_position_min_per_team(
  acting_club_id uuid,
  target_position_id uuid,
  new_min_per_team integer
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  previous_min_per_team smallint;
begin
  select p.min_per_team
    into previous_min_per_team
    from public.club_positions p
   where p.id = target_position_id
     and p.club_id = acting_club_id
     for update;

  -- La de otro club responde igual que una que no existe.
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if previous_min_per_team = new_min_per_team then
    return jsonb_build_object('outcome', 'unchanged');
  end if;

  update public.club_positions p
     set min_per_team = new_min_per_team
   where p.id = target_position_id;

  return jsonb_build_object(
    'outcome', 'changed',
    'previous', previous_min_per_team
  );
end;
$$;

-- Las dos abreviaturas a la vez, nula para dejar un idioma sin ella. Viven en
-- la fila del nombre, así que un idioma sin nombre no puede tener
-- abreviatura: se dice cuál en vez de perderla en silencio.
create or replace function public.set_club_position_short_names(
  acting_club_id uuid,
  target_position_id uuid,
  short_name_en text,
  short_name_es text
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  previous_en text;
  previous_es text;
  unnamed_locale text;
begin
  -- El mismo bloqueo que renombrar (`0027`): un nombre que se borra a la vez
  -- no puede colarse entre la comprobación de abajo y la escritura.
  perform public.lock_club_positions(acting_club_id);

  perform 1
     from public.club_positions p
    where p.id = target_position_id
      and p.club_id = acting_club_id
      for update;

  -- La de otro club responde igual que una que no existe.
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select wanted.locale
    into unnamed_locale
    from (values ('en', short_name_en), ('es', short_name_es))
         as wanted (locale, short_name)
   where wanted.short_name is not null
     and not exists (
       select 1 from public.club_position_names n
        where n.position_id = target_position_id
          and n.locale = wanted.locale
     )
   order by wanted.locale
   limit 1;

  if unnamed_locale is not null then
    return jsonb_build_object('outcome', 'name_missing', 'locale', unnamed_locale);
  end if;

  select max(n.short_name) filter (where n.locale = 'en'),
         max(n.short_name) filter (where n.locale = 'es')
    into previous_en, previous_es
    from public.club_position_names n
   where n.position_id = target_position_id;

  if previous_en is not distinct from short_name_en
     and previous_es is not distinct from short_name_es then
    return jsonb_build_object('outcome', 'unchanged');
  end if;

  update public.club_position_names n
     set short_name = case n.locale
                        when 'en' then short_name_en
                        else short_name_es
                      end
   where n.position_id = target_position_id;

  return jsonb_build_object(
    'outcome', 'changed',
    'previous', jsonb_build_object('en', previous_en, 'es', previous_es)
  );
end;
$$;

-- Escribir es de la llave de servicio, como las funciones de `0027`: el
-- servidor ya comprobó que quien pide es Admin y pasa su club.
revoke all on function
  public.set_club_position_min_per_team(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.set_club_position_min_per_team(uuid, uuid, integer)
  to service_role;

revoke all on function
  public.set_club_position_short_names(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.set_club_position_short_names(uuid, uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
