-- Mantiene la API pública sin funciones SECURITY DEFINER expuestas. Cada helper
-- privado valida auth.uid(), aprobación y permisos antes de mutar datos.
alter function public.create_my_team(text, text) security invoker;
alter function public.invite_team_member(uuid, text) security invoker;
alter function public.accept_team_invitation(uuid) security invoker;
alter function public.admin_set_profile_status(uuid, text) security invoker;

grant execute on function private.enforce_collaborator_limit(uuid) to authenticated;
grant execute on function private.add_collaborator(uuid, uuid, text) to authenticated;
grant execute on function private.create_invitation(uuid, text) to authenticated;
grant execute on function private.accept_invitation(uuid) to authenticated;
grant execute on function private.set_profile_status(uuid, text) to authenticated;
