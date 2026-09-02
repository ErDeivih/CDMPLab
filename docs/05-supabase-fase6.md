# CDMPLab — Fase 6: Aplicar y verificar contra el remoto

> Verificación externa ejecutada el 27/08/2026 contra el proyecto
> `vgwfjkhvzprsoixpzruq`. El esquema y cuatro correcciones incrementales están
> aplicados. La matriz transaccional remota terminó en
> `all_remote_rls_tests_passed` y el asesor de seguridad devolvió cero avisos.

## 1. Aplicar la migración
Migraciones aplicadas, en orden:

- `entrenolab_schema_v1`
- `entrenolab_hardening`
- `fix_invitation_acceptance`
- `rpc_security_invoker`
- `fix_team_rpc_returning`

Los cinco ficheros correspondientes viven en `supabase/migrations/` y
`npm run validate:migration` valida todos ellos, no solo el primero.

Flujo oficial:
```bash
# en EntrenoLab/, con el proyecto enlazado y autenticado
supabase link --project-ref vgwfjkhvzprsoixpzruq
supabase db push   # o `supabase migration up`
# (alternativa MCP: aplicar el SQL mediante apply_migration)
```

Antes de aplicar: revisar el SQL, validar sintaxis y re-consultar el catálogo real.

## 2. Verificar los objetos creados
Tablas: `profiles`, `teams`, `team_members`, `team_invitations`, `players`,
`exercise_folders`, `exercises`, `sessions`, `session_exercises` (public) y
`platform_admins` (private). Índices, funciones (private helpers) y políticas RLS.

```sql
-- pegar el resultado real (catálogo consultado)
select tablename from pg_tables where schemaname in ('public','private') order by 1;
select indexname from pg_indexes where schemaname in ('public','private') order by 1;
select proname from pg_proc where pronamespace in ('public','private'::regnamespace) order by 1;
select policyname, tablename from pg_policies where schemaname='public' order by tablename, policyname;
```

## 3. Advisors
- `supabase db advisors` (o MCP `get_advisors`): corregir todos los avisos relevantes
  de seguridad y rendimiento.
- Revisar: funciones `SECURITY DEFINER` en `public` (no debe haber), EXECUTE revocado,
  RLS activa en todas las tablas expuestas, `search_path = ''`.

## 4. Probar RLS (con distintos roles)
La comprobación externa creó usuarios efímeros dentro de una transacción y la
revirtió al terminar. Verificó propietario, editor invitado, ajeno, pendiente,
suspendido, administrador, quinto colaborador, acceso cruzado entre equipos y
ciclos de carpetas. El fichero `supabase/tests/entrenolab_rls.sql` anterior es solo
un borrador manual con marcadores y **no debe contarse como una prueba automática**;
hay que sustituirlo por la matriz autocontenida antes del despliegue.

| Caso | Comportamiento esperado |
|---|---|
| propietario | ve/gestiona su equipo, crea equipo (solo 1 propio) |
| editor activo | lee/edita datos del equipo; NO gestiona miembros/invitaciones |
| usuario ajeno | no ve datos de otros equipos |
| pending | no accede a ningún equipo |
| suspended | pierde acceso inmediatamente (RLS) |
| rejected | no accede |
| administrador | aprueba/suspende/reactiva perfiles; ve perfiles |

## 5. Límite de colaboradores (concurrente)
- El propietario NO cuenta.
- Máximo 4 entre: colaboradores activos + invitaciones pendientes no caducadas.
- Probar dos invitaciones simultáneas intentando superar el límite (debe rechazarse
  la quinta, sin carrera). Vía `private.enforce_collaborator_limit`.

## 6. Designar al primer administrador
**Después de que David se registre** (confirmar correo). Nunca hardcodear su correo
en Angular. Obtener el UUID de David desde `auth.users`:

```sql
-- 1) ver el usuario (reemplazar por el correo de David):
select id, email, created_at from auth.users where email = '<correo-de-david>';

-- 2) designarlo como admin de plataforma:
insert into private.platform_admins (user_id)
values ('<UUID-de-David>')
on conflict (user_id) do nothing;
```

> No insertar a David como admin por correo. Solo por UUID. `private.platform_admins`
> es inaccesible para clientes (esquema private; EXECUTE/permisos revocados).

## 7. Generar tipos TypeScript
- `supabase gen types typescript --project-id vgwfjkhvzprsoixpzruq > src/app/core/database.types.ts`
- Usar `Database = { ... }` tipado en el cliente Supabase.

## 8. Migración de datos locales (asistente)
Mantener `LocalRepository` (StoreService) para pruebas y recuperación. Asistente:
- Resumen previo de lo que se va a importar.
- Validación.
- Importación atómica (todo o nada; rollback en error).
- Idempotencia (no duplicar si se re-ejecuta).
- Remapeo de IDs (local → remoto).
- Conservar relaciones (carpetas→ejercicios, ejercicios→sesiones).
- Copia JSON local previa.
- NO borrar localStorage automáticamente.
- Mostrar qué se importó y qué se omitió.

## 9. Puertas finales
- Unitarias (98 actuales; revisar tras añadir auth).
- Suite E2E completa.
- Build sin errores.
- Pruebas reales de RLS contra Supabase.
- Advisors sin avisos relevantes.
- Capturas responsive.
- No rebajar budgets ni silenciar avisos. Si el CSS excede el presupuesto,
  refactorizar estilos compartidos o eliminar reglas obsoletas; no aumentar el límite.

## 10. Estado de Git
- No se ha hecho commit ni stage en esta sesión.
- EntrenoLab aparece como directorio sin trackear.

## Confirmaciones pendientes (para la entrega)
- [x] Tablas/restricciones/índices/funciones/políticas comprobadas contra el catálogo real.
- [x] Cinco migraciones aplicadas y registradas en el remoto.
- [x] Asesor de seguridad: 0 avisos.
- [ ] Recuentos exactos de pruebas unitarias/E2E.
- [ ] Capturas generadas.
- [ ] Funciones eliminadas/agrupadas y cómo se conserva su acceso (cosas de Fase 1).
- [ ] Pasos pendientes de SMTP y despliegue (Fase 5).
- [ ] SQL pendiente para designar al primer administrador (arriba).
- [ ] No existe ninguna Secret Key en frontend/repo/logs/capturas.
