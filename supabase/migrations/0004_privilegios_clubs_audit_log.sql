-- Quita los privilegios con los que `public.clubs` y `public.audit_log`
-- nacieron, y vuelve a conceder sólo lo que cada una necesita. Es la mitad de
-- la frontera de NFR-004 que RLS no cubre.
--
-- En este proyecto de Supabase toda tabla nueva del esquema `public` nace con
-- TODOS los privilegios concedidos a `anon` y a `authenticated` (está en su
-- `pg_default_acl`). `0003_members` ya nació con el `revoke` puesto; estas dos
-- son anteriores y se quedaron con los siete: DELETE, INSERT, REFERENCES,
-- SELECT, TRIGGER, TRUNCATE y UPDATE, verificado el 11 de septiembre de 2026
-- en `information_schema.role_table_grants` de desarrollo y de producción.
--
-- Las policies no tapan ese hueco: RLS no filtra `truncate`, `trigger` ni
-- `references`, que se controlan sólo por privilegio. Y `truncate` vacía la
-- tabla entera. Como la llave anónima es pública por diseño (viaja en cada
-- petición del navegador), hasta esta migración cualquiera que la tuviera podía
-- vaciar las dos tablas. De los otros cuatro verbos sí se ocupa RLS, pero en
-- silencio: un `update` sin policy afecta a cero filas y responde en verde, así
-- que el cliente cree que guardó.
--
-- Nada que se apoye en `insert`, `update` o `delete` se rompe al quitarlos: no
-- hay policy que los permita para estos dos roles, así que ya estaban negados.
-- El único camino de escritura de la bitácora sigue siendo la llave de
-- servicio, y a `service_role` no se le toca nada aquí.

revoke all on public.clubs from anon, authenticated;

-- `select` para `authenticated` porque es lo que su policy de lectura deja
-- pasar (`clubs_select_authenticated`, en 0001). Para `anon` también, y no por
-- simetría: la sonda de `/api/v1/health` lee esta tabla con la llave anónima y
-- sin sesión (`src/app/api/v1/health/route.ts`), así que su rol efectivo es
-- `anon`. Sin el privilegio, la consulta pasaría de "cero filas" a "permission
-- denied", la sonda lo leería como base inalcanzable y la vigilancia de
-- producción se quedaría en rojo. Filas sigue sin ver ninguna: para `anon` no
-- hay policy, y RLS niega lo que no tiene policy.
grant select on public.clubs to anon, authenticated;

revoke all on public.audit_log from anon, authenticated;

-- Y aquí no se devuelve nada. `audit_log` la escribe el servidor con la llave
-- de servicio y NFR-010 pide que quien audita no pueda editarla; leerla no la
-- lee nadie todavía, porque su policy niega la lectura a todo `authenticated`
-- hasta que E3 traiga el rol Admin. El `grant select ... to authenticated` de
-- 0002 documentaba esa intención futura sin que nadie la usara: el privilegio
-- que esta tabla necesita hoy es ninguno, y E3 concederá el suyo junto con la
-- policy que lo acompañe. Mientras tanto, un cliente que intente leerla recibe
-- un rechazo claro en vez de una lista vacía.
