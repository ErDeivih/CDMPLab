-- Defensa en profundidad: la tabla privada no es legible directamente por clientes.
-- Las RPC SECURITY DEFINER consultan la tabla con sus propias comprobaciones.
alter table private.platform_admins enable row level security;
drop policy if exists platform_admins_no_direct_access on private.platform_admins;
create policy platform_admins_no_direct_access
  on private.platform_admins
  for all
  to authenticated
  using (false)
  with check (false);
