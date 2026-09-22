-- =============================================================
-- EntrenoLab / CDMPLab — conserva el historial de una solicitud
-- aprobada cuando su equipo se elimina.
--
-- Motivo: `team_requests.created_team_id` tiene ON DELETE SET NULL,
-- pero el CHECK original exigía un equipo para toda solicitud aprobada.
-- Eso hacía imposible borrar el equipo sin borrar indebidamente su
-- solicitud de creación. Una solicitud aprobada sigue siendo aprobada
-- aunque su equipo ya no exista; `created_team_id = NULL` significa
-- precisamente «equipo eliminado posteriormente».
--
-- CATÁLOGO REMOTO VERIFICADO ANTES DE APLICAR (22/09/2026):
-- team_requests_decided_consistency exige created_team_id NOT NULL para
-- status=approved y la FK creada_team_id usa ON DELETE SET NULL.
-- =============================================================

alter table public.team_requests
  drop constraint if exists team_requests_decided_consistency;

alter table public.team_requests
  add constraint team_requests_decided_consistency check (
    (status = 'pending' and decided_at is null and decided_by is null and created_team_id is null)
    or (status = 'rejected' and decided_at is not null and created_team_id is null)
    or (status = 'approved' and decided_at is not null)
  );

