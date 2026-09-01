-- Defensa en profundidad para la tabla privada de administradores. Las
-- funciones SECURITY DEFINER pertenecen al rol propietario y siguen pudiendo
-- consultarla; los clientes no reciben ninguna policy directa.
alter table private.platform_admins enable row level security;

-- Las funciones reciben EXECUTE para PUBLIC por defecto al crearse. La
-- migración 00005 concede después el mínimo acceso necesario a authenticated,
-- por lo que primero retiramos la herencia general de las funciones privadas.
revoke execute on function private.revoke_team_member(uuid, uuid) from public, anon;
revoke execute on function private.cancel_team_invitation(uuid) from public, anon;
revoke execute on function private.list_team_members(uuid) from public, anon;
revoke execute on function private.my_team_invitations() from public, anon;
revoke execute on function private.list_admin_profiles(text) from public, anon;
