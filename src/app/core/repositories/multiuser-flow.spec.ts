// =============================================================================
// EntrenoLab — T4 · Tests de integración MULTIUSUARIO
//
// OBJETIVO
//   Demostrar, de forma DETERMINISTA y sin backend real, el recorrido completo
//   owner → invitación → aceptación → editor → revocación, y las barreras de
//   seguridad que el CLIENTE debe respetar y propagar.
//
// QUÉ SE MOCKEA Y QUÉ NO
//   · Solo se mockea la CAPA DE RED (el cliente Supabase). El repositorio real
//     (SupabaseRepository), la lógica de acceso (access.ts / decideAccess) y los
//     guards se ejecutan tal cual.
//   · El mock es un "backend de prueba" que REPLICA las decisiones que el servidor
//     toma contra RLS/RPC reales (migraciones entrenolab 00000..00006). Es decir:
//     se simulan las policies (is_team_owner / is_team_member / is_approved) y los
//     raises de las RPC con sus códigos exactos. De este modo podemos afirmar que
//     el CLIENTE surface el resultado/error esperado.
//
// QUÉ NOTIENE (honestidad)
//   · Estas pruebas NO demuestran que RLS exista en el servidor real. La barrera
//     real la aplica Postgres en el proyecto remoto (ejecución separada del dueño,
//     `entrenolab_rls.sql`). Aquí solo probamos que el código del cliente llama a
//     las RPC/consultas correctas y traduce bien el veredicto del servidor.
//   · Toda identidad se deriva de auth.uid() (el `userId` que el cliente inyecta),
//     NUNCA de email/metadata. El test de "no email" lo verifica expresamente.
// =============================================================================

import { describe, expect, it, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { SupabaseRepository } from './supabase-data-source';
import { decideAccess } from '../access';
import { AccessService } from '../access.service';
import { SupabaseService } from '../supabase.service';
import { StoreService } from '../store.service';
import type { AccessResolution, TeamInvitationInfo } from './data-source';
import type { CanvasDocument, Exercise, Session, SessionTask } from '../models';

// ---------------------------------------------------------------------------
// Identidades de la matriz multiusuario (uid deterministas, sin emails reales)
// ---------------------------------------------------------------------------

const OWNER = '00000000-0000-0000-0000-000000000001';
const EDITOR = '00000000-0000-0000-0000-000000000002';
const FOREIGN = '00000000-0000-0000-0000-000000000003';
const PENDING = '00000000-0000-0000-0000-000000000004';
const SUSPENDED = '00000000-0000-0000-0000-000000000005';
const OTHER_TEAM_EID = '99999999-0000-0000-0000-000000000099'; // ejercicio de otro equipo

const CANVAS: CanvasDocument = { version: 2, field: 'full', frames: [] };

interface RpcResult {
  data: unknown;
  error: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// BACKEND DE PRUEBA — replica las decisiones RLS/RPC del servidor real
// ---------------------------------------------------------------------------
// Guardo las filas "como las devolvería el servidor" y aplico, en cada lectura/
// escritura, la MISMA política que el repositorio espera del RLS (is_team_member/
// is_team_owner/is_approved, auth.uid()). El cliente mock inyecta la identidad
// (uid) en cada llamada, igual que el auth token real.
// ---------------------------------------------------------------------------

// Filas "como el servidor las devolvería". Usamos `any` a propósito: el backend
// de prueba no necesita tipos, y el repositorio real es quien consume la forma.
// (Vitest transpila sin type-check; esto evita fricción con index signatures.)
type Rw = any;
interface Filter {
  col: string;
  op: 'eq' | 'in' | 'gt';
  val: unknown;
  vals?: unknown[];
}

interface BackendRow {
  profiles: Rw[];
  teams: Rw[];
  team_members: Rw[];
  team_invitations: Rw[];
  /** Cierre del encargo (22/09/2026): solicitudes de equipo. */
  team_requests: Rw[];
  /** Auditoría de bajas de cuenta (migración 20260923000000): sin FK al perfil. */
  account_deletions: Rw[];
  /** Auditoría de equipos eliminados (migración 20260925000000): sin FK al equipo. */
  team_deletions: Rw[];
  players: Rw[];
  exercise_folders: Rw[];
  exercises: Rw[];
  sessions: Rw[];
  session_exercises: Rw[];
}

export class RlsBackend {
  // Visibilidad pública: los tests inspeccionan el estado del "servidor" para
  // verificar que la RLS/RPC simulada mutó las filas correctamente.
  rows: BackendRow = {
    profiles: [],
    teams: [],
    team_members: [],
    team_invitations: [],
    team_requests: [],
    account_deletions: [],
    team_deletions: [],
    players: [],
    exercise_folders: [],
    exercises: [],
    sessions: [],
    session_exercises: [],
  };

  /**
   * Administradores de plataforma simulados (`private.platform_admins`). Sin ninguno
   * dado de alta, `is_platform_admin()` es false para todos, que es el caso por defecto
   * de esta matriz.
   */
  readonly platformAdmins = new Set<string>();

  /** Registro: filtros de colección y llamadas RPC (para el test "sin email"). */
  readonly filters: Filter[] = [];
  readonly rpcCalls: Array<{
    name: string;
    args: unknown;
    uid: string;
    /** Rol del token con el que se llamó: 'authenticated' o 'service_role' (servidor). */
    role: 'authenticated' | 'service_role';
  }> = [];
  readonly eqCalls: Array<{ table: string; col: string; val: unknown }> = [];

  /** Da de alta un administrador de plataforma (equivale a insertar en private.platform_admins). */
  addPlatformAdmin(userId: string): void {
    this.platformAdmins.add(userId);
  }

  // ---------- Seeding ----------

  addProfile(userId: string, displayName: string, email: string, status: string): void {
    this.rows.profiles.push({
      user_id: userId,
      display_name: displayName,
      email_normalized: email.toLowerCase(),
      status,
      approved_at: status === 'approved' ? nowIso() : null,
      approved_by: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  seedTeam(id: string, ownerUserId: string, name: string, accentColor: string): void {
    const now = nowIso();
    this.rows.teams.push({
      id,
      owner_user_id: ownerUserId,
      name,
      accent_color: accentColor,
      created_at: now,
      updated_at: now,
    });
    // Trigger add_owner_membership → el propietario es miembro activo.
    this.rows.team_members.push({
      team_id: id,
      user_id: ownerUserId,
      role: 'owner',
      status: 'active',
      invited_by: null,
      accepted_at: now,
      created_at: now,
    });
  }

  seedPlayer(teamId: string, row: Rw): void {
    this.rows.players.push({
      id: row.id ?? uuid(),
      team_id: teamId,
      name: row.name ?? '',
      number: row.number ?? null,
      position: row.position ?? '',
      color: row.color ?? '#1a73e8',
      active: row.active ?? true,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  seedFolder(teamId: string, row: Rw): void {
    this.rows.exercise_folders.push({
      id: row.id ?? uuid(),
      team_id: teamId,
      parent_id: row.parent_id ?? null,
      name: row.name ?? '',
      created_at: nowIso(),
    });
  }

  seedExercise(teamId: string, row: Rw): void {
    this.rows.exercises.push({
      id: row.id ?? uuid(),
      team_id: teamId,
      folder_id: row.folder_id ?? null,
      title: row.title ?? '',
      description: row.description ?? '',
      explanation: row.explanation ?? '',
      category: row.category ?? 'Técnica',
      objectives: row.objectives ?? [],
      materials: row.materials ?? [],
      duration_minutes: row.duration_minutes ?? null,
      min_players: row.min_players ?? null,
      max_players: row.max_players ?? null,
      load_mode: row.load_mode ?? 'fixed',
      series_count: row.series_count ?? null,
      repetitions_count: row.repetitions_count ?? null,
      work_seconds: row.work_seconds ?? null,
      rest_seconds: row.rest_seconds ?? null,
      is_template: row.is_template ?? false,
      canvas_data: row.canvas_data ?? CANVAS,
      thumbnail: row.thumbnail ?? null,
      revision: row.revision ?? 1,
      created_at: row.created_at ?? nowIso(),
      updated_at: row.updated_at ?? nowIso(),
    });
  }

  /** Crea una sesión y sus session_exercises (para que loadSessions las hidrate). */
  seedSession(
    teamId: string,
    row: Rw,
    tasks: Array<{
      id: string;
      exerciseId: string | null;
      title: string;
      durationMinutes: number | null;
      material: string;
      sortOrder: number;
    }>,
  ): void {
    const now = nowIso();
    const id = (row.id as string) ?? uuid();
    this.rows.sessions.push({
      id,
      team_id: teamId,
      title: row.title ?? '',
      date: row.date ?? null,
      duration_minutes: row.duration_minutes ?? null,
      notes: row.notes ?? '',
      revision: row.revision ?? 1,
      created_at: now,
      updated_at: now,
    });
    this.rows.session_exercises.push(
      ...tasks.map((t, i) => ({
        id: t.id,
        team_id: teamId,
        session_id: id,
        exercise_id: t.exerciseId,
        title: t.title,
        duration_minutes: t.durationMinutes ?? null,
        material: t.material ?? '',
        sort_order: t.sortOrder ?? i,
        created_at: now,
      })),
    );
  }

  forceExerciseTeam(exerciseId: string, teamId: string): void {
    const ex = this.rows.exercises.find((r) => r.id === exerciseId);
    if (ex) ex.team_id = teamId;
  }

  forceOwnedTeam(ownerUserId: string, teamId: string): void {
    const team = this.rows.teams.find((r) => r.id === teamId);
    if (team) team.owner_user_id = ownerUserId;
  }

  // ---------- Helpers de política (R = auth.uid()) ----------

  private profileOf(uid: string): Rw | undefined {
    return this.rows.profiles.find((p) => p.user_id === uid);
  }

  isApproved(uid: string): boolean {
    return this.profileOf(uid)?.status === 'approved';
  }

  isPlatformAdmin(uid: string): boolean {
    // Cierre del encargo (22/09/2026): la matriz multiusuario SÍ necesita administradores
    // (aprobar solicitudes de equipo), así que ahora se pueden dar de alta. Por defecto no
    // hay ninguno, que es como estaba antes.
    return this.platformAdmins.has(uid);
  }

  teamRole(uid: string, teamId: string): 'owner' | 'editor' | 'none' {
    if (!this.isApproved(uid)) return 'none';
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (team?.owner_user_id === uid) return 'owner';
    const row = this.rows.team_members.find(
      (m) => m.team_id === teamId && m.user_id === uid && m.status === 'active',
    );
    return row ? (row.role as 'editor') : 'none';
  }

  isTeamMember(uid: string, teamId: string): boolean {
    return this.teamRole(uid, teamId) === 'owner' || this.teamRole(uid, teamId) === 'editor';
  }

  isTeamOwner(uid: string, teamId: string): boolean {
    return this.teamRole(uid, teamId) === 'owner';
  }

  /** ¿Vale la política SELECT/UPDATE de la tabla para esta fila y usuario? */
  private rowVisible(uid: string, table: string, row: Rw): boolean {
    if (table === 'profiles') return row.user_id === uid || this.isPlatformAdmin(uid);
    if (table === 'teams') return this.isTeamMember(uid, row.id as string);
    // La solicitud la ve quien la presentó y el administrador de plataforma (política
    // `team_requests_select_own_or_admin`). Nadie más.
    if (table === 'team_requests') return row.user_id === uid || this.isPlatformAdmin(uid);
    // La auditoría de bajas solo la lee el administrador (y nadie la escribe desde el cliente).
    if (table === 'account_deletions') return this.isPlatformAdmin(uid);
    // La auditoría de equipos eliminados también es solo del administrador.
    if (table === 'team_deletions') return this.isPlatformAdmin(uid);
    if (table === 'team_invitations') {
      return (
        this.isTeamOwner(uid, row.team_id as string) ||
        (this.isApproved(uid) && row.invited_user_id === uid)
      );
    }
    // team_members, players, exercise_folders, exercises, sessions, session_exercises
    return this.isTeamMember(uid, row.team_id as string);
  }

  /** RLS SELECT: devuelve solo las filas que el usuario puede leer. */
  private selectRows(uid: string, table: string): Rw[] {
    return this.rows[table as keyof BackendRow].filter((r) => this.rowVisible(uid, table, r));
  }

  private canInsert(uid: string, table: string, payload: Rw): boolean {
    if (
      table === 'profiles' ||
      table === 'teams' ||
      table === 'team_members' ||
      table === 'team_invitations' ||
      // Cierre del encargo (22/09/2026): `team_requests` SOLO se lee desde el cliente;
      // escribirla pasa por `request_team_creation` (SECURITY DEFINER). Si el cliente
      // pudiera insertar, podría escribir `status = 'approved'` a mano.
      table === 'team_requests'
    )
      return false; // solo via RPC
    return this.isTeamMember(uid, payload.team_id as string);
  }

  private defaultsForInsert(table: string, p: Rw): Rw {
    const now = nowIso();
    switch (table) {
      case 'players':
        return {
          ...p,
          id: p.id ?? uuid(),
          created_at: p.created_at ?? now,
          updated_at: p.updated_at ?? now,
        };
      case 'exercise_folders':
        return { ...p, id: p.id ?? uuid(), created_at: p.created_at ?? now };
      case 'exercises':
        return {
          ...p,
          id: p.id ?? uuid(),
          revision: p.revision ?? 1,
          created_at: p.created_at ?? now,
          updated_at: p.updated_at ?? now,
        };
      case 'sessions':
        return {
          ...p,
          id: p.id ?? uuid(),
          revision: p.revision ?? 1,
          created_at: p.created_at ?? now,
          updated_at: p.updated_at ?? now,
        };
      case 'session_exercises':
        return { ...p, id: p.id ?? uuid(), created_at: p.created_at ?? now };
      default:
        return { ...p };
    }
  }

  private applyUpdate(table: string, row: Rw, patch: Rw): Rw {
    const updated: Rw = { ...row, ...patch, updated_at: nowIso() };
    if ('revision' in row) updated.revision = (Number(row.revision) || 1) + 1;
    return updated;
  }

  // ---------- RPC ----------

  async rpc(
    name: string,
    args: unknown,
    uid: string,
    role: 'authenticated' | 'service_role' = 'authenticated',
  ): Promise<RpcResult> {
    this.rpcCalls.push({ name, args, uid, role });
    const a = (args ?? {}) as Rw;
    switch (name) {
      // Contrato de copropiedad: el cliente recibe todos los equipos con su rol real.
      case 'my_accessible_teams':
        return ok(
          this.rows.teams
            .filter((team) => this.teamRole(uid, String(team.id)) !== 'none')
            .map((team) => ({ ...team, role: this.teamRole(uid, String(team.id)) })),
        );
      case 'create_my_team':
        return this.rpcCreateMyTeam(a, uid);
      case 'request_team_creation':
        return this.rpcRequestTeamCreation(a, uid);
      case 'admin_list_team_requests':
        return this.rpcAdminListTeamRequests(a, uid);
      case 'admin_decide_team_request':
        return this.rpcAdminDecideTeamRequest(a, uid);
      case 'prepare_invitation_email':
        return this.rpcPrepareInvitationEmail(a, uid);
      case 'record_invitation_email_result':
        return this.rpcRecordInvitationEmailResult(a, role);
      case 'leave_team':
        return this.rpcLeaveTeam(a, uid);
      case 'transfer_team_ownership':
        return this.rpcTransferTeamOwnership(a, uid);
      case 'admin_deletion_preview':
        return this.rpcAdminDeletionPreview(a, uid);
      case 'admin_delete_account':
        return this.rpcAdminDeleteAccount(a, uid);
      case 'team_deletion_preview':
        return this.rpcTeamDeletionPreview(a, uid);
      case 'delete_team':
        return this.rpcDeleteTeam(a, uid);
      case 'invite_team_member':
        return this.rpcInvite(a, uid);
      case 'accept_team_invitation':
        return this.rpcAccept(a, uid);
      case 'my_team_invitations':
        return this.rpcMyInvitations(uid);
      case 'list_team_members':
        return this.rpcListMembers(a, uid);
      case 'admin_team_overview':
        return this.rpcAdminTeamOverview(uid);
      case 'revoke_team_member':
        return this.rpcRevoke(a, uid);
      case 'cancel_team_invitation':
        return this.rpcCancelInvitation(a, uid);
      case 'save_session_with_tasks':
        return this.rpcSaveSession(a, uid);
      default:
        return err('P0001', 'unknown');
    }
  }

  /**
   * `create_my_team` DESPUÉS del cierre del encargo (22/09/2026): sólo un administrador de
   * plataforma puede crear su propio equipo. Antes bastaba con tener el perfil aprobado, y
   * ése era justo el agujero: la cuenta creaba el equipo saltándose al administrador.
   */
  private rpcCreateMyTeam(a: Rw, uid: string): RpcResult {
    const name = String(a.p_name ?? '').trim();
    const color = String(a.p_accent_color ?? '');
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isPlatformAdmin(uid)) return err('42501', 'team_creation_requires_approval');
    if (!name) return err('P0001', 'team_name_required');
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return err('P0001', 'invalid_accent_color');
    if (this.rows.teams.some((t) => t.owner_user_id === uid)) {
      return err('23505', 'duplicate key value violates unique constraint "teams_owner_unique"');
    }
    return ok(this.insertTeam(uid, name, color));
  }

  /** Inserta el equipo y su fila de miembro propietario (trigger add_owner_membership). */
  private insertTeam(ownerUserId: string, name: string, color: string): string {
    const id = uuid();
    const now = nowIso();
    this.rows.teams.push({
      id,
      owner_user_id: ownerUserId,
      name,
      accent_color: color,
      created_at: now,
      updated_at: now,
    });
    this.rows.team_members.push({
      team_id: id,
      user_id: ownerUserId,
      role: 'owner',
      status: 'active',
      invited_by: null,
      accepted_at: now,
      created_at: now,
    });
    return id;
  }

  /**
   * `request_team_creation`: una cuenta aprobada SIN equipo presenta (o ACTUALIZA) su
   * solicitud. Idempotente: una sola solicitud pendiente por usuario.
   */
  private rpcRequestTeamCreation(a: Rw, uid: string): RpcResult {
    const name = String(a.p_name ?? '').trim();
    const color = String(a.p_accent_color ?? '#3056d3').toLowerCase();
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isApproved(uid)) return err('42501', 'profile_not_approved');
    if (!name) return err('P0001', 'team_name_required');
    if (name.length > 80) return err('P0001', 'team_name_too_long');
    if (!/^#[0-9a-f]{6}$/.test(color)) return err('P0001', 'invalid_accent_color');
    if (this.rows.teams.some((t) => t.owner_user_id === uid))
      return err('P0001', 'already_has_team');
    const pending = this.rows.team_requests.find(
      (r) => r.user_id === uid && r.status === 'pending',
    );
    if (pending) {
      pending.name = name;
      pending.accent_color = color;
      pending.revision = Number(pending.revision ?? 1) + 1;
      pending.updated_at = nowIso();
      return ok(pending.id);
    }
    const id = uuid();
    this.rows.team_requests.push({
      id,
      user_id: uid,
      name,
      accent_color: color,
      status: 'pending',
      note: null,
      created_team_id: null,
      requested_at: nowIso(),
      updated_at: nowIso(),
      decided_at: null,
      decided_by: null,
      revision: 1,
    });
    return ok(id);
  }

  /** `admin_list_team_requests`: solo para administradores; pendientes primero. */
  private rpcAdminListTeamRequests(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isPlatformAdmin(uid)) return err('42501', 'platform_admin_required');
    const search = String(a.p_search ?? '')
      .trim()
      .toLowerCase();
    const filas = this.rows.team_requests
      .filter((r) => {
        if (search === '') return true;
        const p = this.profileOf(r.user_id as string);
        return (
          String(r.name ?? '')
            .toLowerCase()
            .includes(search) ||
          String(p?.display_name ?? '')
            .toLowerCase()
            .includes(search) ||
          String(p?.email_normalized ?? '').includes(search)
        );
      })
      .map((r) => {
        const p = this.profileOf(r.user_id as string);
        return {
          id: r.id,
          user_id: r.user_id,
          display_name: p?.display_name ?? '',
          email_normalized: p?.email_normalized ?? '',
          name: r.name,
          accent_color: r.accent_color,
          status: r.status,
          note: r.note,
          requested_at: r.requested_at,
          decided_at: r.decided_at,
          decided_by: r.decided_by,
          created_team_id: r.created_team_id,
        };
      })
      .sort((x, y) => (x.status === y.status ? 0 : x.status === 'pending' ? -1 : 1));
    return ok(filas);
  }

  /**
   * `admin_decide_team_request`: al APROBAR crea el equipo en la misma transacción; es
   * idempotente (repetir devuelve el mismo equipo) y reutiliza el equipo si ya existe.
   */
  private rpcAdminDecideTeamRequest(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isPlatformAdmin(uid)) return err('42501', 'platform_admin_required');
    const req = this.rows.team_requests.find((r) => r.id === (a.p_request_id as string));
    if (!req) return err('P0001', 'team_request_not_found');
    const approve = a.p_approve === true;
    if (req.status === 'approved') {
      if (approve) return ok(req.created_team_id);
      return err('P0001', 'team_request_already_approved');
    }
    if (req.status === 'rejected' && !approve) return ok(null);
    if (!approve) {
      req.status = 'rejected';
      const note = String(a.p_note ?? '').trim();
      req.note = note === '' ? null : note;
      req.decided_at = nowIso();
      req.decided_by = uid;
      return ok(null);
    }
    const prof = this.profileOf(req.user_id as string);
    if (!prof || prof.status !== 'approved') return err('P0001', 'requester_not_approved');
    let team = this.rows.teams.find((t) => t.owner_user_id === req.user_id);
    if (!team) {
      this.insertTeam(req.user_id as string, req.name as string, req.accent_color as string);
      team = this.rows.teams.find((t) => t.owner_user_id === req.user_id);
    }
    req.status = 'approved';
    req.note = null;
    req.decided_at = nowIso();
    req.decided_by = uid;
    req.created_team_id = team!.id;
    return ok(team!.id);
  }

  /** `prepare_invitation_email`: autoriza por propiedad, aplica cooldown y tope y ABRE intento. */ private rpcPrepareInvitationEmail(
    a: Rw,
    uid: string,
  ): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    const inv = this.rows.team_invitations.find((i) => i.id === (a.p_invitation_id as string));
    if (!inv) return err('P0001', 'invitation_not_available');
    if (!this.isTeamOwner(uid, inv.team_id as string))
      return err('42501', 'forbidden: not team owner');
    if (inv.status !== 'pending' || new Date(inv.expires_at as string).getTime() <= Date.now())
      return err('P0001', 'invitation_not_available');
    const last = inv.last_email_at ? new Date(inv.last_email_at as string).getTime() : 0;
    if (inv.email_status !== 'send_error' && last && Date.now() - last < 60_000)
      return err('P0001', 'email_cooldown');
    if (Number(inv.email_attempts ?? 0) >= 5) return err('P0001', 'email_attempt_limit');
    inv.email_status = 'send_pending';
    inv.email_attempts = Number(inv.email_attempts ?? 0) + 1;
    inv.last_email_at = nowIso();
    // Intento NUEVO: invalida el identificador de cualquier envío anterior.
    inv.email_attempt_id = uuid();
    const team = this.rows.teams.find((t) => t.id === inv.team_id);
    return ok({
      invitation_id: inv.id,
      team_id: inv.team_id,
      team_name: team?.name ?? '',
      email: inv.email_normalized,
      link_path: `/invitations?invitation=${inv.id}`,
      attempt_id: inv.email_attempt_id,
    });
  }

  /**
   * `record_invitation_email_result`: SOLO con la credencial de servicio (como en el servidor) y
   * vinculado al intento vigente.
   *
   * CAMBIO DE CONTRATO (revisión del dueño, 22/09/2026): antes bastaba con ser el propietario, así
   * que un propietario podía falsificar `provider_accepted` y el identificador del proveedor sin
   * enviar nada. Ahora el rol `authenticated` recibe «permission denied», igual que en PostgreSQL
   * al no tener EXECUTE.
   */
  private rpcRecordInvitationEmailResult(a: Rw, role: 'authenticated' | 'service_role'): RpcResult {
    if (role !== 'service_role') {
      return err('42501', 'permission denied for function record_invitation_email_result');
    }
    const status = String(a.p_status ?? '');
    if (status !== 'provider_accepted' && status !== 'send_error')
      return err('P0001', 'invalid_email_status');
    if (!a.p_attempt_id) return err('P0001', 'email_attempt_required');
    const inv = this.rows.team_invitations.find((i) => i.id === (a.p_invitation_id as string));
    if (!inv) return err('P0001', 'invitation_not_available');
    // Vinculación al intento: una respuesta tardía del intento anterior NO escribe nada.
    if (inv.email_attempt_id !== a.p_attempt_id) return err('P0001', 'stale_email_attempt');
    inv.email_status = status;
    if (status === 'provider_accepted') {
      inv.provider_message_id = String(a.p_provider_message_id ?? '').slice(0, 120);
      inv.last_email_error = null;
    } else {
      inv.last_email_error = String(a.p_error ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 300);
    }
    return ok(null);
  }

  // ---------- Gestión de cuentas y pertenencia (migración 20260923000000) ----------

  /**
   * `leave_team`: lo decide el propio MIEMBRO ACTIVO. El propietario no puede salir (dejaría el
   * equipo sin dueño) y hay que ser miembro activo. Mismas consecuencias que una revocación: la
   * membresía queda `revoked` (no se borra: el histórico se conserva).
   */
  private rpcLeaveTeam(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isApproved(uid)) return err('P0001', 'profile_not_approved');
    const teamId = a.p_team_id as string;
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (!team) return err('P0001', 'team_not_found');
    if (team.owner_user_id === uid) return err('P0001', 'owner_cannot_leave');
    const membership = this.rows.team_members.find(
      (m) => m.team_id === teamId && m.user_id === uid && m.status === 'active',
    );
    if (!membership) return err('P0001', 'not_a_member');
    membership.status = 'revoked';
    membership.accepted_at = null;
    for (const inv of this.rows.team_invitations) {
      if (inv.team_id === teamId && inv.invited_user_id === uid && inv.status === 'pending') {
        inv.status = 'revoked';
      }
    }
    return ok(null);
  }

  /**
   * `transfer_team_ownership`: solo el propietario actual, y solo a un EDITOR ACTIVO, aprobado y
   * sin equipo propio. Intercambio de roles en una transacción (mismo número de cuentas).
   */
  private rpcTransferTeamOwnership(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    const teamId = a.p_team_id as string;
    const nuevo = a.p_new_owner_user_id as string;
    if (!this.isTeamOwner(uid, teamId)) return err('P0001', 'forbidden: not team owner');
    if (nuevo === uid) return err('P0001', 'already_owner');
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (!team) return err('P0001', 'team_not_found');
    const objetivo = this.rows.team_members.find(
      (m) =>
        m.team_id === teamId && m.user_id === nuevo && m.status === 'active' && m.role === 'editor',
    );
    if (!objetivo) return err('P0001', 'new_owner_must_be_active_member');
    if (!this.isApproved(nuevo)) return err('P0001', 'new_owner_not_approved');
    if (this.rows.teams.some((t) => t.owner_user_id === nuevo)) {
      return err('P0001', 'new_owner_already_has_team');
    }
    const mio = this.rows.team_members.find((m) => m.team_id === teamId && m.user_id === uid)!;
    team.owner_user_id = nuevo;
    objetivo.role = 'owner';
    objetivo.accepted_at = objetivo.accepted_at ?? nowIso();
    mio.role = 'editor';
    mio.status = 'active';
    mio.accepted_at = mio.accepted_at ?? nowIso();
    return ok(null);
  }

  /** `admin_deletion_preview`: qué se llevaría por delante y qué lo bloquea. */
  private rpcAdminDeletionPreview(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isPlatformAdmin(uid)) return err('42501', 'platform_admin_required');
    const objetivo = a.p_user_id as string;
    const prof = this.profileOf(objetivo);
    if (!prof) return ok({ found: false, user_id: objetivo });
    const equipo = this.rows.teams.find((t) => t.owner_user_id === objetivo);
    const blockers: string[] = [];
    if (equipo) blockers.push('owns_team');
    if (objetivo === uid) blockers.push('self');
    if (this.platformAdmins.has(objetivo)) blockers.push('platform_admin');
    const cuenta = (tabla: 'players' | 'exercise_folders' | 'exercises' | 'sessions'): number =>
      equipo ? this.rows[tabla].filter((r) => r.team_id === equipo.id).length : 0;
    return ok({
      found: true,
      user_id: prof.user_id,
      display_name: prof.display_name,
      email_normalized: prof.email_normalized,
      status: prof.status,
      is_platform_admin: this.platformAdmins.has(objetivo),
      is_self: objetivo === uid,
      owns_team: Boolean(equipo),
      owned_team_name: equipo?.name ?? null,
      owned_team_data: {
        players: cuenta('players'),
        folders: cuenta('exercise_folders'),
        exercises: cuenta('exercises'),
        sessions: cuenta('sessions'),
      },
      active_memberships: this.rows.team_members.filter(
        (m) => m.user_id === objetivo && m.status === 'active',
      ).length,
      pending_invitations: this.rows.team_invitations.filter(
        (i) => i.invited_user_id === objetivo && i.status === 'pending',
      ).length,
      blockers,
      deletable: blockers.length === 0,
    });
  }

  /**
   * `admin_delete_account`: guardas (no a uno mismo, no a otro administrador, no a quien posee un
   * equipo), registro en la auditoría ANTES del borrado y borrado en cascada del usuario.
   */
  private rpcAdminDeleteAccount(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isPlatformAdmin(uid)) return err('42501', 'platform_admin_required');
    const objetivo = a.p_user_id as string;
    const prof = this.profileOf(objetivo);
    if (!prof) return err('P0001', 'account_not_found');
    if (objetivo === uid) return err('P0001', 'cannot_delete_self');
    if (this.platformAdmins.has(objetivo)) return err('P0001', 'cannot_delete_platform_admin');
    if (this.rows.teams.some((t) => t.owner_user_id === objetivo)) {
      return err('P0001', 'target_owns_team');
    }
    // Auditoría SIN clave foránea: sobrevive al borrado (y va antes, en la misma transacción).
    this.rows.account_deletions.push({
      id: uuid(),
      deleted_user_id: objetivo,
      email_normalized: prof.email_normalized,
      display_name: prof.display_name,
      status_before: prof.status,
      reason: a.p_reason ?? null,
      deleted_by: uid,
      deleted_at: nowIso(),
    });
    // Cascada del borrado del usuario de Auth: perfil + membresías; las referencias quedan a NULL.
    this.rows.profiles = this.rows.profiles.filter((p) => p.user_id !== objetivo);
    this.rows.team_members = this.rows.team_members.filter((m) => m.user_id !== objetivo);
    // CONTRATO ACTUALIZADO (migración 20260923154020): las invitaciones PENDIENTES del usuario se
    // REVOCAN antes de borrar (la vista previa promete «se cancelarán»). Sin esto quedarían
    // huérfanas: seguían ocupando plaza, bloqueaban reinvitar a ese correo y serían aceptables por
    // quien registrara ese correo después.
    for (const inv of this.rows.team_invitations) {
      if (inv.invited_user_id === objetivo && inv.status === 'pending') inv.status = 'revoked';
    }
    for (const inv of this.rows.team_invitations) {
      if (inv.invited_user_id === objetivo) inv.invited_user_id = null;
      if (inv.invited_by === objetivo) inv.invited_by = null;
    }
    for (const m of this.rows.team_members) {
      if (m.invited_by === objetivo) m.invited_by = null;
    }
    for (const r of this.rows.team_requests) {
      if (r.user_id === objetivo) r.user_id = null;
      if (r.decided_by === objetivo) r.decided_by = null;
    }
    return ok({ deleted: true, user_id: objetivo, email_normalized: prof.email_normalized });
  }

  // ---------- Borrado de EQUIPO (migración 20260925000000) ----------

  /** Resumen de lo que hay en un equipo (lo que se llevará por delante el borrado). */
  private resumenEquipo(teamId: string): Rw {
    const cuenta = (tabla: 'players' | 'exercise_folders' | 'exercises' | 'sessions'): number =>
      this.rows[tabla].filter((r) => r.team_id === teamId).length;
    return {
      players: cuenta('players'),
      folders: cuenta('exercise_folders'),
      exercises: cuenta('exercises'),
      sessions: cuenta('sessions'),
      members: this.rows.team_members.filter((m) => m.team_id === teamId).length,
      pending_invitations: this.rows.team_invitations.filter(
        (i) => i.team_id === teamId && i.status === 'pending',
      ).length,
    };
  }

  /** `team_deletion_preview`: lo mira el propietario del equipo o un administrador. */
  private rpcTeamDeletionPreview(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    const teamId = a.p_team_id as string;
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (!team) return ok({ found: false, team_id: teamId });
    const owner = this.profileOf(team.owner_user_id as string);
    const isOwner = team.owner_user_id === uid;
    const isPlatformAdmin = this.isPlatformAdmin(uid);
    if (!isOwner && !isPlatformAdmin) return err('42501', 'not_authorized_for_team_deletion');
    return ok({
      found: true,
      team_id: team.id,
      name: team.name,
      accent_color: team.accent_color,
      owner_user_id: team.owner_user_id,
      owner_email: owner?.email_normalized ?? '',
      is_owner: isOwner,
      is_platform_admin: isPlatformAdmin,
      can_delete: true,
      confirm_name_required: team.name,
      data: this.resumenEquipo(teamId),
    });
  }

  /**
   * `delete_team`: propietario o administrador, y CONFIRMACIÓN REFORZADA EN EL SERVIDOR (el
   * nombre exacto del equipo). Deja auditoría y arrastra por cascada todo lo del equipo.
   */
  private rpcDeleteTeam(a: Rw, uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    const teamId = a.p_team_id as string;
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (!team) return err('P0001', 'team_not_found');
    if (team.owner_user_id !== uid && !this.isPlatformAdmin(uid)) {
      return err('42501', 'not_authorized_for_team_deletion');
    }
    const escrito = String(a.p_confirm_name ?? '').trim();
    if (escrito === '' || escrito !== team.name) {
      return err('P0001', 'team_name_confirmation_mismatch');
    }
    const resumen = this.resumenEquipo(teamId);
    const owner = this.profileOf(team.owner_user_id as string);
    // Auditoría ANTES del borrado (sin FK al equipo: sobrevive).
    this.rows.team_deletions.push({
      id: uuid(),
      deleted_team_id: team.id,
      team_name: team.name,
      owner_user_id: team.owner_user_id,
      owner_email: owner?.email_normalized ?? '',
      data_summary: resumen,
      reason: a.p_reason ?? null,
      deleted_by: uid,
      deleted_at: nowIso(),
    });
    // Cascada: todo lo que cuelga del equipo.
    this.rows.teams = this.rows.teams.filter((t) => t.id !== teamId);
    this.rows.team_members = this.rows.team_members.filter((m) => m.team_id !== teamId);
    this.rows.team_invitations = this.rows.team_invitations.filter((i) => i.team_id !== teamId);
    for (const tabla of ['players', 'exercise_folders', 'exercises', 'sessions'] as const) {
      this.rows[tabla] = this.rows[tabla].filter((r) => r.team_id !== teamId);
    }
    // Las solicitudes que apuntaban al equipo quedan sin equipo creado (FK `on delete set null`).
    for (const r of this.rows.team_requests) {
      if (r.created_team_id === teamId) r.created_team_id = null;
    }
    return ok({ deleted: true, team_id: team.id, name: team.name, data: resumen });
  }

  private rpcInvite(a: Rw, uid: string): RpcResult {
    const teamId = a.p_team_id as string;
    const normalized = String(a.p_email ?? '')
      .trim()
      .toLowerCase();
    if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized))
      return err('P0001', 'invalid_invitation_email');
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (!team) return err('P0001', 'team_not_found');
    if (!this.isTeamOwner(uid, teamId)) return err('P0001', 'forbidden: not team owner');
    const used =
      this.rows.team_members.filter(
        (m) => m.team_id === teamId && m.status === 'active' && m.role !== 'owner',
      ).length +
      this.rows.team_invitations.filter(
        (i) =>
          i.team_id === teamId &&
          i.status === 'pending' &&
          new Date(i.expires_at as string).getTime() > Date.now(),
      ).length;
    if (used >= 6) return err('P0001', 'collaborator_limit_exceeded');
    const target = this.rows.profiles.find((p) => p.email_normalized === normalized);
    const invId = uuid();
    const now = nowIso();
    this.rows.team_invitations.push({
      id: invId,
      team_id: teamId,
      email_normalized: normalized,
      invited_user_id: target?.user_id ?? null,
      status: 'pending',
      invited_by: uid,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: now,
      // Columnas del CORREO (migración 20260922000000): la invitación nace 'created'.
      email_status: 'created',
      email_attempts: 0,
      last_email_at: null,
      last_email_error: null,
      provider_message_id: null,
      email_attempt_id: null,
    });
    return ok(invId);
  }

  private rpcAccept(a: Rw, uid: string): RpcResult {
    const prof = this.profileOf(uid);
    if (!prof || prof.status !== 'approved') return err('P0001', 'profile_not_approved');
    const inv = this.rows.team_invitations.find((i) => i.id === (a.p_invitation_id as string));
    if (
      !inv ||
      inv.status !== 'pending' ||
      new Date(inv.expires_at as string).getTime() <= Date.now()
    ) {
      return err('P0001', 'invitation_not_available');
    }
    if (inv.email_normalized !== prof.email_normalized)
      return err('P0001', 'invitation_email_mismatch');
    inv.status = 'accepted';
    inv.invited_user_id = uid;
    const existing = this.rows.team_members.find(
      (m) => m.team_id === inv.team_id && m.user_id === uid,
    );
    const now = nowIso();
    if (existing) {
      existing.role = 'editor';
      existing.status = 'active';
      existing.accepted_at = existing.accepted_at ?? now;
    } else {
      this.rows.team_members.push({
        team_id: inv.team_id,
        user_id: uid,
        role: 'editor',
        status: 'active',
        invited_by: inv.invited_by as string | null,
        accepted_at: now,
        created_at: now,
      });
    }
    return ok(inv.team_id);
  }

  private rpcMyInvitations(uid: string): RpcResult {
    const rows = this.rows.team_invitations
      .filter(
        (i) =>
          i.invited_user_id === uid &&
          i.status === 'pending' &&
          new Date(i.expires_at as string).getTime() > Date.now(),
      )
      .map((i) => ({
        id: i.id,
        team_id: i.team_id,
        team_name: this.rows.teams.find((t) => t.id === i.team_id)?.name ?? '',
        email_normalized: i.email_normalized,
        status: i.status,
        expires_at: i.expires_at,
        created_at: i.created_at,
      }));
    return ok(rows);
  }

  private rpcListMembers(a: Rw, uid: string): RpcResult {
    const teamId = a.p_team_id as string;
    // CONTRATO ACTUALIZADO (migración 20260928000000): el propietario conserva su acceso y el
    // ADMINISTRADOR de plataforma puede ver los miembros de cualquier equipo desde el panel
    // global. Un editor normal sigue recibiendo «forbidden».
    if (!this.isTeamOwner(uid, teamId) && !this.isPlatformAdmin(uid)) {
      return err('P0001', 'forbidden: not team owner');
    }
    const rows = this.rows.team_members
      .filter((m) => m.team_id === teamId)
      .map((m) => {
        const prof = this.rows.profiles.find((p) => p.user_id === m.user_id);
        return {
          user_id: m.user_id,
          display_name: prof?.display_name ?? '',
          email_normalized: prof?.email_normalized ?? '',
          role: m.role,
          status: m.status,
          accepted_at: m.accepted_at ?? null,
          invited_by: m.invited_by ?? null,
        };
      });
    return ok(rows);
  }

  /**
   * `admin_team_overview()` (migración 20260923091218): recuentos de TODOS los equipos, en una
   * sola llamada y solo para el administrador de plataforma. Devuelve RECUENTOS y metadatos, nunca
   * el contenido de un equipo.
   */
  private rpcAdminTeamOverview(uid: string): RpcResult {
    if (!uid) return err('42501', 'not_authenticated');
    if (!this.isPlatformAdmin(uid)) return err('42501', 'platform_admin_required');
    const cuenta = (filas: Rw[], coincide: (f: Rw) => boolean) => filas.filter(coincide).length;
    const rows = this.rows.teams.map((t) => {
      const teamId = t.id as string;
      const perfilDueno = this.rows.profiles.find((p) => p.user_id === t.owner_user_id);
      return {
        team_id: teamId,
        name: t.name,
        accent_color: t.accent_color,
        owner_user_id: t.owner_user_id,
        owner_email: perfilDueno?.email_normalized ?? '',
        created_at: t.created_at,
        updated_at: t.updated_at,
        members_active: cuenta(
          this.rows.team_members,
          (m) => m.team_id === teamId && m.status === 'active',
        ),
        members_revoked: cuenta(
          this.rows.team_members,
          (m) => m.team_id === teamId && m.status === 'revoked',
        ),
        members_pending: cuenta(
          this.rows.team_members,
          (m) => m.team_id === teamId && m.status === 'pending_approval',
        ),
        invitations_pending: cuenta(
          this.rows.team_invitations,
          (i) =>
            i.team_id === teamId &&
            i.status === 'pending' &&
            Date.parse(String(i.expires_at)) > Date.now(),
        ),
        // CONTRATO ACTUALIZADO (migración 20260923154046): las caducadas se cuentan APARTE, porque
        // no ocupan plaza pero sí bloquean volver a invitar a ese correo.
        invitations_expired_pending: cuenta(
          this.rows.team_invitations,
          (i) =>
            i.team_id === teamId &&
            i.status === 'pending' &&
            Date.parse(String(i.expires_at)) <= Date.now(),
        ),
        players_active: cuenta(this.rows.players, (p) => p.team_id === teamId && p.active === true),
        players_inactive: cuenta(
          this.rows.players,
          (p) => p.team_id === teamId && p.active !== true,
        ),
        folders: cuenta(this.rows.exercise_folders, (f) => f.team_id === teamId),
        exercises: cuenta(this.rows.exercises, (e) => e.team_id === teamId),
        sessions: cuenta(this.rows.sessions, (s) => s.team_id === teamId),
      };
    });
    return ok(rows);
  }

  private rpcRevoke(a: Rw, uid: string): RpcResult {
    const teamId = a.p_team_id as string;
    const target = a.p_user_id as string;
    if (!this.isTeamOwner(uid, teamId)) return err('P0001', 'forbidden: not team owner');
    const team = this.rows.teams.find((t) => t.id === teamId);
    if (team?.owner_user_id === target) return err('P0001', 'cannot_revoke_owner');
    for (const m of this.rows.team_members) {
      if (m.team_id === teamId && m.user_id === target && m.status === 'active') {
        m.status = 'revoked';
        m.accepted_at = null;
      }
    }
    for (const i of this.rows.team_invitations) {
      if (i.team_id === teamId && i.invited_user_id === target && i.status === 'pending')
        i.status = 'revoked';
    }
    return ok(null);
  }

  private rpcCancelInvitation(a: Rw, uid: string): RpcResult {
    const inv = this.rows.team_invitations.find((i) => i.id === (a.p_invitation_id as string));
    if (!inv) return err('P0001', 'invitation_not_found');
    if (!this.isTeamOwner(uid, inv.team_id as string))
      return err('P0001', 'forbidden: not team owner');
    if (inv.status !== 'pending') return err('P0001', 'invitation_not_available');
    inv.status = 'revoked';
    return ok(null);
  }

  private rpcSaveSession(a: Rw, uid: string): RpcResult {
    const s = a.p_session as Rw;
    const teamId = s.team_id as string;
    const sessionId = s.id as string;
    if (!this.isTeamMember(uid, teamId)) return err('42501', 'forbidden: not a member of the team');
    let vRow: Rw | null = null;
    const existing = this.rows.sessions.find((x) => x.id === sessionId);
    if (existing) {
      if (existing.team_id !== teamId)
        return err('42501', 'forbidden: session belongs to another team');
      if ((existing.revision as number) !== Number(a.p_revision ?? null))
        return err('P0001', 'revision_conflict');
      vRow = existing;
    }
    // Valida ANTES de mutar (transacción: si esto falla, no se cambia nada).
    const tasks = (a.p_tasks as Rw[]) ?? [];
    for (const t of tasks) {
      const eid = t.exercise_id;
      if (eid) {
        const ex = this.rows.exercises.find((e) => e.id === eid);
        if (!ex || ex.team_id !== teamId) return err('P0001', 'same_team_exercise_required');
      }
    }
    // Aplica la mutación (insert o update con bump de revisión).
    if (vRow) {
      vRow.title = s.title ?? '';
      vRow.date = s.date ?? null;
      vRow.duration_minutes = s.duration_minutes ?? null;
      vRow.notes = s.notes ?? '';
      vRow.updated_at = nowIso();
      vRow.revision = (vRow.revision as number) + 1;
    } else {
      const now = nowIso();
      vRow = {
        id: sessionId,
        team_id: teamId,
        title: s.title ?? '',
        date: s.date ?? null,
        duration_minutes: s.duration_minutes ?? null,
        notes: s.notes ?? '',
        revision: 1,
        created_at: now,
        updated_at: now,
      };
      this.rows.sessions.push(vRow);
    }
    // Reemplazo atómico de tareas (misma transacción).
    this.rows.session_exercises = this.rows.session_exercises.filter(
      (se) => se.session_id !== sessionId,
    );
    for (const t of tasks) {
      this.rows.session_exercises.push({
        id: t.id ?? uuid(),
        team_id: teamId,
        session_id: sessionId,
        exercise_id: t.exercise_id ?? null,
        title: t.title ?? '',
        duration_minutes: t.duration_minutes ?? null,
        material: t.material ?? '',
        sort_order: Number(t.sort_order ?? 0),
        created_at: nowIso(),
      });
    }
    return ok(vRow);
  }

  // ---------- Acceso a tablas (para el cliente mock) ----------

  tableQuery(table: string, uid: string): RwQuery {
    let mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let payload: Rw | null = null;
    const filters: Filter[] = [];
    const orderBy: Array<{ col: string; asc: boolean }> = [];
    let rangeWindow: { from: number; to: number } | null = null;
    let limitWindow: number | null = null;
    let selectReturn = false;
    let limitSingle: 'single' | 'maybeSingle' | null = null;

    const recordFilter = (col: string, val: unknown, op: 'eq' | 'in' | 'gt', vals?: unknown[]) => {
      filters.push({ col, op, val, vals });
      this.filters.push({ col, op, val, vals });
      if (op === 'eq') this.eqCalls.push({ table, col, val });
    };

    const applyFilters = (rows: Rw[]): Rw[] => {
      let out = rows;
      for (const f of filters) {
        if (f.op === 'eq') out = out.filter((r) => String(r[f.col]) === String(f.val));
        else if (f.op === 'gt') out = out.filter((r) => String(r[f.col]) > String(f.val));
        else out = out.filter((r) => (f.vals ?? []).includes(String(r[f.col])));
      }
      return out;
    };

    const finishRead = (rows: Rw[]): RpcResult => {
      if (limitSingle === 'single') {
        if (rows.length === 1) return ok(rows[0]);
        return err('PGRST116', 'JSON object requested, multiple (or no) rows returned');
      }
      if (limitSingle === 'maybeSingle') return ok(rows[0] ?? null);
      return ok(rows);
    };

    const finishWrite = (rows: Rw[]): RpcResult => {
      if (limitSingle === 'single') return ok(rows[0] ?? null);
      if (limitSingle === 'maybeSingle') return ok(rows[0] ?? null);
      if (selectReturn) return ok(rows);
      return ok(null);
    };

    const execute = async (): Promise<RpcResult> => {
      if (mode === 'select') {
        let rows = this.selectRows(uid, table);
        rows = applyFilters(rows);
        // PostgREST admite varios `.order()`: el criterio y, después, los desempates.
        const keys = orderBy;
        if (keys.length) {
          rows = [...rows].sort((a, b) => {
            for (const key of keys) {
              const av = a[key.col];
              const bv = b[key.col];
              if (av === bv) continue;
              const cmp = av < bv ? -1 : 1;
              return key.asc ? cmp : -cmp;
            }
            return 0;
          });
        }
        // `.range(from, to)` es el offset/limit de PostgREST (el recorte por `max-rows` no se
        // emula aquí: estas pruebas usan datasets pequeños).
        if (rangeWindow) rows = rows.slice(rangeWindow.from, rangeWindow.to + 1);
        // `.limit(n)` es el recorte de PostgREST (lo usa la lectura de la solicitud propia).
        if (limitWindow != null) rows = rows.slice(0, limitWindow);
        return finishRead(rows);
      }
      if (mode === 'insert') {
        const p = payload as Rw;
        if (!this.canInsert(uid, table, p)) {
          return err('42501', 'new row violates row-level security policy');
        }
        const row = this.defaultsForInsert(table, p);
        this.rows[table as keyof BackendRow].push(row);
        return finishWrite([row]);
      }
      if (mode === 'update') {
        // RLS UPDATE (USING is_team_member) + filtros explícitos (incl. revision).
        let rows = this.selectRows(uid, table);
        rows = applyFilters(rows);
        if (rows.length === 0) return finishWrite([]);
        const store = this.rows[table as keyof BackendRow];
        const updated = rows.map((r) => this.applyUpdate(table, r, payload as Rw));
        // Escribe las filas actualizadas de vuelta al "servidor".
        const byRef = new Map<Rw, Rw>();
        rows.forEach((r, i) => byRef.set(r, updated[i]));
        for (let i = 0; i < store.length; i++) {
          const repl = byRef.get(store[i]);
          if (repl) store[i] = repl;
        }
        return finishWrite(updated);
      }
      // delete
      // RLS DELETE: las tablas de identidad/membresía NO tienen política de borrado (y
      // `profiles` tampoco GRANT), así que el cliente solo puede darlas de baja por RPC. Se
      // modela aquí para poder probar que un borrado directo NO es una vía alternativa.
      const soloPorRpc: string[] = [
        'profiles',
        'teams',
        'team_members',
        'team_invitations',
        'team_requests',
        'account_deletions',
        'team_deletions',
      ];
      if (soloPorRpc.includes(table)) {
        return err('42501', 'new row violates row-level security policy');
      }
      const visible = this.selectRows(uid, table);
      const toDelete = applyFilters(visible).filter((r) =>
        this.isTeamMember(uid, r.team_id as string),
      );
      const del = new Set(toDelete.map((r) => r));
      this.rows[table as keyof BackendRow] = this.rows[table as keyof BackendRow].filter(
        (r) => !del.has(r),
      );
      return ok(null);
    };

    const builder: RwQuery = {
      select: () => {
        selectReturn = true;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        recordFilter(col, val, 'eq');
        return builder;
      },
      gt: (col: string, val: unknown) => {
        recordFilter(col, val, 'gt');
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        recordFilter(col, vals, 'in', vals);
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy.push({ col, asc: opts?.ascending ?? true });
        return builder;
      },
      range: (from: number, to: number) => {
        rangeWindow = { from, to };
        return builder;
      },
      limit: (n: number) => {
        limitWindow = n;
        return builder;
      },
      update: (p: Rw) => {
        mode = 'update';
        payload = p;
        return builder;
      },
      insert: (p: Rw) => {
        mode = 'insert';
        payload = p;
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      maybeSingle: () => {
        limitSingle = 'maybeSingle';
        return builder;
      },
      single: () => {
        limitSingle = 'single';
        return builder;
      },
      then: (resolve: (v: RpcResult) => unknown, reject: (e: unknown) => unknown) =>
        execute().then(resolve, reject),
    };

    return builder;
  }
}

/** Interfaz mínima del query-builder que usa el repositorio. */
export interface RwQuery {
  select: (cols?: string) => RwQuery;
  eq: (col: string, val: unknown) => RwQuery;
  gt: (col: string, val: unknown) => RwQuery;
  in: (col: string, vals: unknown[]) => RwQuery;
  order: (col: string, opts?: { ascending?: boolean }) => RwQuery;
  range: (from: number, to: number) => RwQuery;
  limit: (n: number) => RwQuery;
  update: (p: Rw) => RwQuery;
  insert: (p: Rw) => RwQuery;
  delete: () => RwQuery;
  maybeSingle: () => RwQuery;
  single: () => RwQuery;
  then: (resolve: (v: RpcResult) => unknown, reject: (e: unknown) => unknown) => Promise<unknown>;
}

function ok(data: unknown): RpcResult {
  return { data, error: null };
}

function err(code: string, message: string): RpcResult {
  return { data: null, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Cliente mock: inyecta la identidad del usuario en cada llamada a rpc/from
// (equivale al auth token real, nunca email/metadata).
// ---------------------------------------------------------------------------

/**
 * Cliente mock: inyecta la identidad del usuario en cada llamada a rpc/from
 * (equivale al auth token real, nunca email/metadata).
 *
 * `role` modela el ROL del token: 'authenticated' (navegador) o 'service_role' (la credencial
 * del SERVIDOR que nunca llega al navegador). Es lo que permite comprobar que el registro del
 * resultado del correo solo lo puede hacer el servidor.
 */
function makeRlsClient(
  backend: RlsBackend,
  userId: string,
  role: 'authenticated' | 'service_role' = 'authenticated',
) {
  const rpcMock = vi.fn((name: string, args: unknown) => {
    if (name !== 'my_accessible_teams') return backend.rpc(name, args, userId, role);
    let start = 0;
    let end = 999;
    const query = {
      order: () => query,
      range: (from: number, to: number) => {
        start = from;
        end = to;
        return query;
      },
      then: (resolve: (value: RpcResult) => unknown, reject: (error: unknown) => unknown) =>
        backend
          .rpc(name, args, userId, role)
          .then((result) => ({
            ...result,
            data: Array.isArray(result.data) ? result.data.slice(start, end + 1) : result.data,
          }))
          .then(resolve, reject),
    };
    return query;
  });
  const fromMock = vi.fn((table: string): unknown => backend.tableQuery(table, userId));
  const client = { rpc: rpcMock, from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, rpcMock, fromMock, userId, role };
}

function makeRepo(
  backend: RlsBackend,
  userId: string,
  teamId: string | null,
  role: 'authenticated' | 'service_role' = 'authenticated',
): SupabaseRepository {
  const { client } = makeRlsClient(backend, userId, role);
  return new SupabaseRepository(client, userId, teamId);
}

/**
 * Llama a una RPC como lo haría el SERVIDOR: con la credencial de servicio, que no lleva
 * usuario. Es la única forma legítima de registrar el resultado de un envío.
 */
function rpcServidor(backend: RlsBackend, name: string, args: unknown): Promise<RpcResult> {
  return backend.rpc(name, args, '', 'service_role');
}

/** Llama a una RPC como lo haría el NAVEGADOR autenticado (la vía que debe estar cerrada). */
function rpcNavegador(
  backend: RlsBackend,
  name: string,
  args: unknown,
  uid: string,
): Promise<RpcResult> {
  return backend.rpc(name, args, uid, 'authenticated');
}

// ---------------------------------------------------------------------------
// Fixtures comunes
// ---------------------------------------------------------------------------

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    teamId: 'team-1',
    folderId: null,
    title: 'Rondos',
    description: 'desc',
    explanation: 'expl',
    category: 'Técnica',
    objectives: [],
    materials: [],
    durationMinutes: 15,
    minPlayers: null,
    maxPlayers: null,
    loadMode: 'fixed',
    seriesCount: null,
    repetitionsCount: null,
    workSeconds: null,
    restSeconds: null,
    isTemplate: false,
    canvas: CANVAS,
    thumbnail: null,
    savedAt: 'now',
    revision: 1,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const tasks: SessionTask[] = [
    {
      id: 't1',
      exerciseId: 'ex-1',
      title: 'Rondos',
      durationMinutes: 15,
      material: '',
      sortOrder: 0,
    },
  ];
  return {
    id: 's-1',
    teamId: 'team-1',
    title: 'Sesión 1',
    date: '2026-01-01',
    durationMinutes: 60,
    notes: 'notas',
    tasks,
    createdAt: 'c',
    savedAt: 'u',
    revision: 1,
    ...overrides,
  };
}

/** Crea el escenario base: propietario + editor + extranjero + pendiente + suspendido. */
function setupJourney() {
  const backend = new RlsBackend();
  backend.addProfile(OWNER, 'Ana Owner', 'owner@example.com', 'approved');
  backend.addProfile(EDITOR, 'Pedro Editor', 'editor@example.com', 'approved');
  backend.addProfile(FOREIGN, 'Luis Foreign', 'foreign@example.com', 'approved');
  backend.addProfile(PENDING, 'Pendiente', 'pending@example.com', 'pending');
  backend.addProfile(SUSPENDED, 'Suspendido', 'suspended@example.com', 'suspended');
  return { backend };
}

/** Cuenta administradora de plataforma usada en esta matriz (nadie más lo es). */
const ADMIN = '00000000-0000-0000-0000-0000000000ad';

/** Alta del administrador de plataforma en el backend simulado (con su perfil, como en remoto). */
function conAdmin(backend: RlsBackend): void {
  backend.addPlatformAdmin(ADMIN);
  if (!backend.rows.profiles.some((p) => p.user_id === ADMIN)) {
    backend.addProfile(ADMIN, 'Admin Plataforma', 'admin@example.com', 'approved');
  }
}

/**
 * Da de alta el equipo de `userId` por la vía REAL del cierre del encargo (22/09/2026):
 * la cuenta presenta una SOLICITUD y un administrador la aprueba; el equipo lo crea el
 * servidor al aprobar. Sustituye a los antiguos `repo.createTeam(...)`, que ya no existen.
 */
async function pedirYAprobarEquipo(
  backend: RlsBackend,
  userId: string,
  name: string,
  color = '#3056d3',
): Promise<{ id: string; name: string; accentColor: string; createdAt: string }> {
  conAdmin(backend);
  const repo = makeRepo(backend, userId, null);
  const request = await repo.requestTeamCreation(name, color);
  const adminRepo = makeRepo(backend, ADMIN, null);
  const teamId = await adminRepo.decideTeamRequest(request.id, true, null);
  if (!teamId) throw new Error('la aprobación no devolvió equipo');
  return { id: teamId, name, accentColor: color, createdAt: nowIso() };
}

/** Editor con una invitación pendiente (aún no aceptada) → estado accept-invitation. */
async function invitedEditorScenario() {
  const { backend } = setupJourney();
  const ownerRepo = makeRepo(backend, OWNER, null);
  const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');
  const invitation = await ownerRepo.inviteMember(team.id, 'editor@example.com');
  return { backend, team, invitation };
}

/**
 * Recorrido feliz completo hasta tener un equipo con datos y un editor activo.
 * Devuelve los repos listos para las aserciones.
 */
async function fullJourney() {
  const { backend } = setupJourney();
  const ownerRepo = makeRepo(backend, OWNER, null);
  const editorRepo = makeRepo(backend, EDITOR, null);

  const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer Equipo');
  backend.seedPlayer(team.id, {
    id: 'p1',
    name: 'Marcos',
    number: 2,
    position: 'DF',
    color: '#1a73e8',
    active: true,
  });
  backend.seedFolder(team.id, { id: 'f1', name: 'Ataque' });
  backend.seedExercise(team.id, {
    id: 'ex-1',
    team_id: team.id,
    title: 'Rondos',
    folder_id: 'f1',
    revision: 1,
  });
  backend.seedSession(
    team.id,
    {
      id: 's-1',
      team_id: team.id,
      title: 'Sesión 1',
      date: '2026-01-01',
      duration_minutes: 60,
      notes: 'notas',
      revision: 1,
    },
    [
      {
        id: 't1',
        exerciseId: 'ex-1',
        title: 'Rondos',
        durationMinutes: 15,
        material: '',
        sortOrder: 0,
      },
    ],
  );

  const invitation = await ownerRepo.inviteMember(team.id, 'editor@example.com');
  await editorRepo.acceptInvitation(invitation.id);
  editorRepo.setTeam(team.id);

  return { backend, ownerRepo, editorRepo, team, invitation };
}

// =============================================================================
// 1 · OBJETO DEL RECORRIDO MULTIUSUARIO
// =============================================================================

describe('T4 multiuser — el viaje completo (owner → invitado → editor → revocado)', () => {
  it('la cuenta aprobada SOLICITA su equipo y el administrador lo aprueba: el equipo es suyo', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);
    const repo = makeRepo(backend, OWNER, null);

    // 1) Solicitud (la cuenta NO crea nada todavía).
    const request = await repo.requestTeamCreation('Primer Equipo', '#3056d3');
    expect(request.status).toBe('pending');
    expect(backend.rows.teams).toHaveLength(0);

    // 2) Intento de BYPASS por RPC: `create_my_team` ya no crea equipos a un no administrador.
    //    Se llama DIRECTAMENTE al servidor simulado: si la interfaz no lo hace, el servidor
    //    tampoco lo permite (la seguridad no puede depender de la pantalla).
    const porRpc = await backend.rpc(
      'create_my_team',
      { p_name: 'Equipo por RPC', p_accent_color: '#3056d3' },
      OWNER,
    );
    expect((porRpc.error as { message: string } | null)?.message).toContain(
      'team_creation_requires_approval',
    );
    expect(backend.rows.teams).toHaveLength(0);

    // 3) Intento de BYPASS por INSERT directo en `teams`: sin GRANT y sin política de INSERT.
    const porInsert = await backend
      .tableQuery('teams', OWNER)
      .insert({ owner_user_id: OWNER, name: 'Equipo por INSERT', accent_color: '#3056d3' });
    expect(porInsert.error).not.toBeNull();
    expect(backend.rows.teams).toHaveLength(0);

    // 4) El cliente ya NO tiene siquiera el método que creaba el equipo: si alguien lo
    //    reintrodujera, esta prueba se cae.
    expect((repo as unknown as Record<string, unknown>)['createTeam']).toBeUndefined();

    // 5) Aprobación del administrador: el equipo lo crea el SERVIDOR.
    const adminRepo = makeRepo(backend, ADMIN, null);
    const teamId = await adminRepo.decideTeamRequest(request.id, true, null);
    expect(teamId).toBeTruthy();

    // El equipo es SUYO (derivado de auth.uid(), no del email).
    const access = await repo.resolveAccess();
    expect(access.ownedTeam?.id).toBe(teamId);
    expect(access.ownedTeam?.name).toBe('Primer Equipo');
    expect(access.membership).toBeNull();
    expect(backend.rows.teams).toHaveLength(1);

    // Idempotencia: repetir la aprobación devuelve el MISMO equipo y no crea otro.
    await expect(adminRepo.decideTeamRequest(request.id, true, null)).resolves.toBe(teamId);
    expect(backend.rows.teams).toHaveLength(1);
  });

  it('la solicitud es idempotente: dos envíos seguidos = UNA solicitud pendiente (se actualiza)', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const primera = await repo.requestTeamCreation('Primer Equipo', '#3056d3');
    const segunda = await repo.requestTeamCreation('Primer Equipo (v2)', '#c8102e');
    expect(segunda.id).toBe(primera.id);
    expect(backend.rows.team_requests).toHaveLength(1);
    expect(segunda.name).toBe('Primer Equipo (v2)');
    expect(segunda.accentColor).toBe('#c8102e');
  });

  it('un perfil NO aprobado no puede solicitar equipo', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, PENDING, null);
    await expect(repo.requestTeamCreation('Equipo', '#3056d3')).rejects.toMatchObject({
      code: 'profile_not_approved',
    });
    expect(backend.rows.team_requests).toHaveLength(0);
  });

  it('el rechazo deja motivo, no crea equipo y permite VOLVER a solicitar', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);
    const repo = makeRepo(backend, OWNER, null);
    const adminRepo = makeRepo(backend, ADMIN, null);

    const primera = await repo.requestTeamCreation('Equipo', '#3056d3');
    await expect(
      adminRepo.decideTeamRequest(primera.id, false, 'Falta documentación del club.'),
    ).resolves.toBeNull();
    expect(backend.rows.teams).toHaveLength(0);

    // El solicitante VE el motivo del rechazo.
    const rechazada = await repo.myTeamRequest();
    expect(rechazada?.status).toBe('rejected');
    expect(rechazada?.note).toBe('Falta documentación del club.');

    // Y puede volver a solicitarlo (fila nueva, una sola pendiente).
    const segunda = await repo.requestTeamCreation('Equipo', '#3056d3');
    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.status).toBe('pending');

    // Ahora sí: aprobación → equipo creado.
    await expect(adminRepo.decideTeamRequest(segunda.id, true, null)).resolves.toBeTruthy();
    expect(backend.rows.teams).toHaveLength(1);
  });

  it('solo el administrador de plataforma ve y decide solicitudes (un propietario NO)', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);
    const repo = makeRepo(backend, OWNER, null);
    const ajenoRepo = makeRepo(backend, FOREIGN, null);
    const request = await repo.requestTeamCreation('Equipo', '#3056d3');

    // Un usuario normal no puede ni listar la cola ni decidir.
    await expect(ajenoRepo.listTeamRequests('')).rejects.toMatchObject({
      code: 'platform_admin_required',
    });
    await expect(ajenoRepo.decideTeamRequest(request.id, true, null)).rejects.toMatchObject({
      code: 'platform_admin_required',
    });
    // Ni siquiera el PROPIO solicitante puede aprobarse.
    await expect(repo.decideTeamRequest(request.id, true, null)).rejects.toMatchObject({
      code: 'platform_admin_required',
    });
    expect(backend.rows.teams).toHaveLength(0);

    // La RLS solo le deja leer SU solicitud (no las de los demás).
    expect(await ajenoRepo.myTeamRequest()).toBeNull();
    expect((await repo.myTeamRequest())?.id).toBe(request.id);

    // El administrador sí, y la cola identifica a quien la pidió.
    const adminRepo = makeRepo(backend, ADMIN, null);
    const cola = await adminRepo.listTeamRequests('');
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({ id: request.id, status: 'pending', displayName: 'Ana Owner' });
  });

  it('una aprobación cuya cuenta dejó de estar aprobada se rechaza (requester_not_approved)', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);
    const repo = makeRepo(backend, OWNER, null);
    const adminRepo = makeRepo(backend, ADMIN, null);
    const request = await repo.requestTeamCreation('Equipo', '#3056d3');

    // El administrador suspende la cuenta entre la solicitud y la aprobación.
    const profile = backend.rows.profiles.find((p) => p.user_id === OWNER)!;
    profile.status = 'suspended';

    await expect(adminRepo.decideTeamRequest(request.id, true, null)).rejects.toMatchObject({
      code: 'requester_not_approved',
    });
    expect(backend.rows.teams).toHaveLength(0);
  });

  it('el propietario invita a un usuario aprobado y la invitación se crea pendiente y con email_normalized', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');

    const invitation = await repo.inviteMember(team.id, '  Editor@Example.com  ');
    expect(invitation.status).toBe('pending');
    expect(invitation.emailNormalized).toBe('editor@example.com'); // está normalizado (lower/trim)
    expect(invitation.teamId).toBe(team.id);
    expect(invitation.invitedUserId).toBe(EDITOR);
  });

  // =========================================================================
  // CIERRE DEL ENCARGO — CORREO: quién puede registrar el resultado del proveedor
  // (revisión del dueño, 22/09/2026). El registro está en manos del SERVIDOR: el
  // navegador no puede falsificar un `provider_accepted` ni el id del proveedor, y una
  // respuesta tardía de un intento viejo no puede sobrescribir el intento vigente.
  // =========================================================================

  /** Escenario listo para el correo: dueño con equipo, invitación pendiente preparada. */
  async function conIntentoPreparado() {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');
    const invitation = await repo.inviteMember(team.id, 'editor@example.com');
    const prepared = await rpcNavegador(
      backend,
      'prepare_invitation_email',
      { p_invitation_id: invitation.id },
      OWNER,
    );
    const attemptId = (prepared.data as { attempt_id?: string } | null)?.attempt_id ?? '';
    return { backend, repo, team, invitation, attemptId };
  }

  it('el registro del resultado exige la credencial del SERVIDOR: el propietario no puede falsificar provider_accepted', async () => {
    const { backend, invitation, attemptId } = await conIntentoPreparado();
    expect(attemptId).not.toBe('');

    // El PROPIETARIO autenticado lo intenta por la vía directa (como haría un navegador
    // malicioso con la RPC): debe recibir el mismo «permission denied» que da PostgreSQL.
    const porPropietario = await rpcNavegador(
      backend,
      'record_invitation_email_result',
      {
        p_invitation_id: invitation.id,
        p_attempt_id: attemptId,
        p_status: 'provider_accepted',
        p_provider_message_id: 'falsificado-123',
        p_error: null,
      },
      OWNER,
    );
    expect((porPropietario.error as { message: string } | null)?.message).toContain(
      'permission denied for function record_invitation_email_result',
    );
    // Y NADA ha cambiado: sigue en `send_pending` y sin identificador de proveedor.
    const fila = backend.rows.team_invitations.find((i) => i.id === invitation.id)!;
    expect(fila.email_status).toBe('send_pending');
    expect(fila.provider_message_id).toBeNull();
  });

  it('un NO propietario tampoco puede registrar el resultado (ni con el intento correcto)', async () => {
    const { backend, invitation, attemptId } = await conIntentoPreparado();
    const ajeno = await rpcNavegador(
      backend,
      'record_invitation_email_result',
      {
        p_invitation_id: invitation.id,
        p_attempt_id: attemptId,
        p_status: 'provider_accepted',
        p_provider_message_id: 'falsificado-456',
        p_error: null,
      },
      EDITOR,
    );
    expect(ajeno.error).not.toBeNull();
    const fila = backend.rows.team_invitations.find((i) => i.id === invitation.id)!;
    expect(fila.email_status).toBe('send_pending');
    expect(fila.provider_message_id).toBeNull();
  });

  it('el SERVIDOR sí lo registra, con el intento vigente (y solo con él)', async () => {
    const { backend, invitation, attemptId } = await conIntentoPreparado();

    // Sin identificador de intento no se registra nada.
    const sinIntento = await rpcServidor(backend, 'record_invitation_email_result', {
      p_invitation_id: invitation.id,
      p_attempt_id: null,
      p_status: 'provider_accepted',
      p_provider_message_id: 'prov-1',
      p_error: null,
    });
    expect((sinIntento.error as { message: string } | null)?.message).toContain(
      'email_attempt_required',
    );

    // Con el intento vigente, sí.
    const correcto = await rpcServidor(backend, 'record_invitation_email_result', {
      p_invitation_id: invitation.id,
      p_attempt_id: attemptId,
      p_status: 'provider_accepted',
      p_provider_message_id: 'prov-1',
      p_error: null,
    });
    expect(correcto.error).toBeNull();
    const fila = backend.rows.team_invitations.find((i) => i.id === invitation.id)!;
    expect(fila.email_status).toBe('provider_accepted');
    expect(fila.provider_message_id).toBe('prov-1');
  });

  it('un resultado de un intento ANTIGUO no cambia el estado del intento nuevo', async () => {
    const { backend, invitation, attemptId: intentoViejo } = await conIntentoPreparado();
    const fila = backend.rows.team_invitations.find((i) => i.id === invitation.id)!;
    expect(fila.email_status).toBe('send_pending');

    // El envío FALLA → se puede reintentar de inmediato (así lo permite el servidor) → intento NUEVO.
    await rpcServidor(backend, 'record_invitation_email_result', {
      p_invitation_id: invitation.id,
      p_attempt_id: intentoViejo,
      p_status: 'send_error',
      p_provider_message_id: null,
      p_error: 'rechazado por el proveedor',
    });
    expect(fila.email_status).toBe('send_error');

    const reintento = await rpcNavegador(
      backend,
      'prepare_invitation_email',
      { p_invitation_id: invitation.id },
      OWNER,
    );
    const intentoNuevo = (reintento.data as { attempt_id?: string } | null)?.attempt_id ?? '';
    expect(intentoNuevo).not.toBe(intentoViejo);
    expect(fila.email_status).toBe('send_pending');

    // Llega TARDE la respuesta del intento viejo (un `provider_accepted`): NO debe pisar el nuevo.
    const tardio = await rpcServidor(backend, 'record_invitation_email_result', {
      p_invitation_id: invitation.id,
      p_attempt_id: intentoViejo,
      p_status: 'provider_accepted',
      p_provider_message_id: 'prov-tardio',
      p_error: null,
    });
    expect((tardio.error as { message: string } | null)?.message).toContain('stale_email_attempt');
    expect(fila.email_status).toBe('send_pending');
    expect(fila.provider_message_id).toBeNull();

    // Y el intento nuevo sí puede cerrarse.
    await rpcServidor(backend, 'record_invitation_email_result', {
      p_invitation_id: invitation.id,
      p_attempt_id: intentoNuevo,
      p_status: 'provider_accepted',
      p_provider_message_id: 'prov-nuevo',
      p_error: null,
    });
    expect(fila.email_status).toBe('provider_accepted');
    expect(fila.provider_message_id).toBe('prov-nuevo');
  });

  it('el cliente NO tiene ningún método para registrar el resultado del proveedor', async () => {
    // Contrato de diseño: si alguien añadiera un método al repositorio para escribir el
    // resultado del correo, esta prueba se cae (el registro es del servidor, no del cliente).
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null) as unknown as Record<string, unknown>;
    for (const nombre of [
      'recordInvitationEmailResult',
      'recordEmailResult',
      'setInvitationEmailStatus',
    ]) {
      expect(repo[nombre], `el cliente no debe exponer ${nombre}`).toBeUndefined();
    }
  });
  it('admite seis colaboradores pendientes además del propietario y rechaza el séptimo', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');

    for (let i = 0; i < 6; i++) {
      await expect(
        repo.inviteMember(team.id, `colaborador${i}@example.com`),
      ).resolves.toMatchObject({
        status: 'pending',
      });
    }
    expect(backend.rows.team_invitations.filter((i) => i.status === 'pending')).toHaveLength(6);
    await expect(repo.inviteMember(team.id, 'septimo@example.com')).rejects.toMatchObject({
      code: 'collaborator_limit_exceeded',
    });
  });

  it('una invitación caducada se mantiene visible para cancelarla, pero no ocupa plaza', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');
    const invitation = await repo.inviteMember(team.id, 'caducado@example.com');
    const row = backend.rows.team_invitations.find((i) => i.id === invitation.id)!;
    row.expires_at = '2000-01-01T00:00:00.000Z';

    expect(await repo.listTeamInvitations(team.id)).toEqual([
      expect.objectContaining({
        id: invitation.id,
        emailNormalized: 'caducado@example.com',
        status: 'pending',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }),
    ]);
    await expect(repo.inviteMember(team.id, 'vigente@example.com')).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('el invitado ve la invitación SIN pertenecer aún a un equipo (my_team_invitations)', async () => {
    const { backend } = setupJourney();
    const ownerRepo = makeRepo(backend, OWNER, null);
    const editorRepo = makeRepo(backend, EDITOR, null);
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');
    await ownerRepo.inviteMember(team.id, 'editor@example.com');

    // El editor todavía no tiene equipo/teamId de contexto.
    const access = await editorRepo.resolveAccess();
    expect(access.ownedTeam).toBeNull();
    expect(access.membership).toBeNull();
    expect(access.pendingInvitations).toHaveLength(1);
    expect(access.pendingInvitations[0].teamId).toBe(team.id);
    expect(access.pendingInvitations[0].status).toBe('pending');
  });

  it('el invitado acepta y pasa a ser un EDITOR ACTIVO; la invitación pasa a accepted', async () => {
    const { backend } = setupJourney();
    const ownerRepo = makeRepo(backend, OWNER, null);
    const editorRepo = makeRepo(backend, EDITOR, null);
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Primer');
    const invitation = await ownerRepo.inviteMember(team.id, 'editor@example.com');

    const acceptedTeamId = await editorRepo.acceptInvitation(invitation.id);
    expect(acceptedTeamId).toBe(team.id);

    // Ahora el editor es miembro activo (rol editor) y ya no tiene invitaciones pendientes.
    const access = await editorRepo.resolveAccess();
    expect(access.membership).toEqual({ teamId: team.id, role: 'editor' });
    expect(access.pendingInvitations).toHaveLength(0);

    // La invitación pasó a 'accepted' en el backend.
    const invRow = backend.rows.team_invitations.find((i) => i.id === invitation.id);
    expect(invRow?.status).toBe('accepted');

    // El propietario ve al editor como miembro activo.
    const members = await ownerRepo.listMembers(team.id);
    expect(members).toContainEqual(
      expect.objectContaining({ userId: EDITOR, role: 'editor', status: 'active' }),
    );
  });

  it('el editor carga el equipo y ve los datos comunes SIN las RPC exclusivas del propietario', async () => {
    const { ownerRepo, editorRepo, team } = await fullJourney();
    // Autoriza que el editor cargue los datos comunes del equipo.
    const listMembers = vi.spyOn(editorRepo, 'listMembers');
    const listInvitations = vi.spyOn(editorRepo, 'listTeamInvitations');

    const dataset = await editorRepo.loadTeam(team.id);

    expect(dataset.team?.id).toBe(team.id);
    expect(dataset.players).toHaveLength(1);
    expect(dataset.folders).toHaveLength(1);
    expect(dataset.exercises).toHaveLength(1);
    expect(dataset.sessions).toHaveLength(1);
    // Los recursos de gestión (solo owner) NO se cargan para el editor.
    expect(dataset.members).toEqual([]);
    expect(dataset.invitations).toEqual([]);
    expect(listMembers).not.toHaveBeenCalled();
    expect(listInvitations).not.toHaveBeenCalled();
  });

  it('la edición del editor la ve el propietario; el write sube la revision (optimismo entre clientes)', async () => {
    const { backend, editorRepo, team } = await fullJourney();
    const ownerRepo = makeRepo(backend, OWNER, team.id);

    const edited = await editorRepo.saveExercise(
      makeExercise({ id: 'ex-1', teamId: team.id, title: 'Rondos mejorado' }),
      1,
    );
    expect(edited.conflict).toBeUndefined();
    expect(edited.revision).toBe(2);

    // El propietario (repositorio distinto) ve el cambio.
    const ownerExercises = (await ownerRepo.loadTeam(team.id)).exercises;
    const seen = ownerExercises.find((e) => e.id === 'ex-1');
    expect(seen?.title).toBe('Rondos mejorado');
    expect(seen?.revision).toBe(2);
  });

  it('un conflicto de revisión se rechaza y NO sobrescribe en silencio', async () => {
    const { backend, editorRepo, team } = await fullJourney();
    const ownerRepo = makeRepo(backend, OWNER, team.id);

    // Un primer guardado legítimo sube la revisión a 2.
    await editorRepo.saveExercise(
      makeExercise({ id: 'ex-1', teamId: team.id, title: 'Versión 2' }),
      1,
    );

    // Ahora un guardado con la revisión 1 (ya stale) se rechaza como conflicto.
    const result = await editorRepo.saveExercise(
      makeExercise({ id: 'ex-1', teamId: team.id, title: 'Cambio perdido' }),
      1,
    );
    expect(result.conflict).toBe(true);
    expect(result.revision).toBe(2); // expone la revisión real del servidor

    // El dato NO se sobrescribió: sigue la versión 2.
    const seen = (await ownerRepo.loadTeam(team.id)).exercises.find((e) => e.id === 'ex-1');
    expect(seen?.title).toBe('Versión 2');
    expect(seen?.revision).toBe(2);
  });

  it('revocar al editor le quita el acceso de LECTURA y de ESCRITURA de inmediato', async () => {
    const { backend, ownerRepo, editorRepo, team } = await fullJourney();

    await ownerRepo.revokeMember(team.id, EDITOR);

    // Lectura: el equipo queda vacío para el editor.
    const dataset = await editorRepo.loadTeam(team.id);
    expect(dataset.team).toBeNull();
    expect(dataset.players).toEqual([]);
    expect(dataset.folders).toEqual([]);
    expect(dataset.exercises).toEqual([]);
    expect(dataset.sessions).toEqual([]);

    // Escritura (update): el bloqueo RLS devuelve 0 filas → el repo lo trata como conflicto
    // (no como sobrescritura); el dato del propietario queda intacto.
    const staleSave = await editorRepo.saveExercise(
      makeExercise({ id: 'ex-1', teamId: team.id, title: 'No debe guardarse' }),
      2,
    );
    expect(staleSave.conflict).toBe(true);
    const ownerSees = (await ownerRepo.loadTeam(team.id)).exercises.find((e) => e.id === 'ex-1');
    expect(ownerSees?.title).not.toBe('No debe guardarse');

    // Escritura nueva (insert): la RLS la rechaza con error.
    await expect(
      editorRepo.saveExercise(makeExercise({ id: 'ex-new', teamId: team.id, title: 'Nuevo' })),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // La membresía del editor quedó marcada como revocada.
    const invRowMember = backend.rows.team_members.find(
      (m) => m.user_id === EDITOR && m.team_id === team.id,
    );
    expect(invRowMember?.status).toBe('revoked');
  });

  it('«Guardar mi copia» sobre un ejercicio BORRADO lo vuelve a crear (antes: conflicto eterno)', async () => {
    const { ownerRepo, editorRepo, team } = await fullJourney();
    const original = (await ownerRepo.loadTeam(team.id)).exercises.find((e) => e.id === 'ex-1')!;
    expect(original, 'el viaje completo deja el ejercicio ex-1').toBeTruthy();
    await ownerRepo.deleteExercise(original.id);

    // Sin la bandera, guardar con la revisión leída NO resucita nada: sigue siendo conflicto.
    const conflicto = await editorRepo.saveExercise(
      makeExercise({ id: original.id, teamId: team.id, title: 'Mi versión' }),
      original.revision,
    );
    expect(conflicto.conflict).toBe(true);

    // Con la bandera («Guardar mi copia») sí se guarda: antes reenviaba un UPDATE que volvía a
    // afectar 0 filas, así que el conflicto se repetía para siempre y el trabajo del usuario no se
    // podía guardar nunca. Se conserva el id para no romper las tareas de sesión que lo referencian.
    const copia = await editorRepo.saveExercise(
      makeExercise({ id: original.id, teamId: team.id, title: 'Mi versión' }),
      original.revision,
      { recreateIfMissing: true },
    );
    expect(copia.conflict).toBeFalsy();
    expect(copia.recreated).toBe(true);
    const guardado = (await ownerRepo.loadTeam(team.id)).exercises.find(
      (e) => e.id === original.id,
    );
    expect(guardado?.title).toBe('Mi versión');
  });

  it('un usuario EXTRAÑO nunca ve los datos del equipo', async () => {
    const { backend, team } = await fullJourney();
    const foreignRepo = makeRepo(backend, FOREIGN, null);

    const dataset = await foreignRepo.loadTeam(team.id);
    expect(dataset.team).toBeNull();
    expect(dataset.players).toEqual([]);
    expect(dataset.folders).toEqual([]);
    expect(dataset.exercises).toEqual([]);
    expect(dataset.sessions).toEqual([]);

    // No puede listar miembros ni revocar (solo el propietario).
    await expect(foreignRepo.listMembers(team.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(foreignRepo.revokeMember(team.id, EDITOR)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('los usuarios pendientes y suspendidos NO acceden a los datos del equipo', async () => {
    const { backend, team } = await fullJourney();
    const pendingRepo = makeRepo(backend, PENDING, null);
    const suspendedRepo = makeRepo(backend, SUSPENDED, null);

    const pendingDataset = await pendingRepo.loadTeam(team.id);
    expect(pendingDataset.team).toBeNull();
    expect(pendingDataset.players).toEqual([]);

    const suspendedDataset = await suspendedRepo.loadTeam(team.id);
    expect(suspendedDataset.team).toBeNull();
    expect(suspendedDataset.players).toEqual([]);

    // El estado del perfil manda: pending/suspended nunca llegan a "ready".
    const pendingAccess = await pendingRepo.resolveAccess();
    expect(pendingAccess.profile.status).toBe('pending');
    const suspendedAccess = await suspendedRepo.resolveAccess();
    expect(suspendedAccess.profile.status).toBe('suspended');
  });

  it('un editor NO puede invocar las RPC de gestión exclusivas del propietario', async () => {
    const { editorRepo, team, invitation } = await fullJourney();

    // listMembers / revokeMember / inviteMember vetan al editor (solo owner).
    await expect(editorRepo.listMembers(team.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(editorRepo.revokeMember(team.id, OWNER)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(editorRepo.inviteMember(team.id, 'otro@example.com')).rejects.toMatchObject({
      code: 'forbidden',
    });

    // listTeamInvitations es por RLS: el editor (no owner) solo vería las suyas →
    // tras aceptar, no ve ninguna; no puede enumerar las invitaciones del equipo.
    const invites = await editorRepo.listTeamInvitations(team.id);
    expect(invites).toEqual([]);
  });

  it('la identidad se deriva de auth.uid() y NUNCA de email/metadata', async () => {
    const { backend, ownerRepo, editorRepo, team } = await fullJourney();

    // 1) Los filtros de identidad de las lecturas/accesso son por user/owner/team_id.
    backend.filters.length = 0;
    backend.eqCalls.length = 0;
    await ownerRepo.resolveAccess();
    await ownerRepo.loadTeam(team.id);
    await editorRepo.resolveAccess();
    await editorRepo.loadTeam(team.id);

    const emailCols = backend.eqCalls.filter((c) => /email|metadata|raw_user_meta/gi.test(c.col));
    expect(emailCols).toEqual([]);
    const identityCols = backend.eqCalls.map((c) => c.col);
    expect(identityCols).toContain('user_id'); // profiles / team_members
    // La propiedad ya no depende de la referencia heredada: la RPC usa auth.uid().
    expect(backend.rpcCalls.some((call) => call.name === 'my_accessible_teams')).toBe(true);
    expect(identityCols).toContain('team_id'); // scoping de equipo

    // 2) Cambiar el email del propietario NO cambia su identidad ni su acceso.
    const ownerProfile = backend.rows.profiles.find((p) => p.user_id === OWNER);
    const ownerBefore = (await ownerRepo.resolveAccess()).ownedTeam?.id;
    ownerProfile!.email_normalized = 'otra-direccion@example.com';
    const ownerAfter = (await ownerRepo.resolveAccess()).ownedTeam?.id;
    expect(ownerAfter).toBe(ownerBefore);
    expect(ownerAfter).toBe(team.id);
  });
});

// =============================================================================
// 2 · ATOMICIDAD / INTEGRIDAD DE SESIÓN (multi-cliente)
// =============================================================================

describe('T4 multiuser — integridad de saveSession (RPC transaccional)', () => {
  it('un editor puede guardar la sesión de su equipo', async () => {
    const { editorRepo, team } = await fullJourney();
    const saved = await editorRepo.saveSession(makeSession({ teamId: team.id, revision: 1 }));
    expect(saved.id).toBe('s-1');
    expect(saved.revision).toBe(2);
  });

  it('una tarea que referencia un ejercicio de OTRO equipo se rechaza (same_team_exercise_required)', async () => {
    const { backend, editorRepo, team } = await fullJourney();
    // Mete un ejercicio que pertenece a otro equipo.
    backend.seedExercise('other-team', { id: OTHER_TEAM_EID, title: 'De otro' });
    backend.forceExerciseTeam(OTHER_TEAM_EID, 'other-team');

    await expect(
      editorRepo.saveSession(
        makeSession({
          teamId: team.id,
          revision: 1,
          tasks: [
            {
              id: 'tX',
              exerciseId: OTHER_TEAM_EID,
              title: 'Roto',
              durationMinutes: 10,
              material: '',
              sortOrder: 0,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'same_team_exercise_required' });
  });

  it('un editor revocado no puede guardar la sesión (pertenencia vetada por RLS)', async () => {
    const { backend, ownerRepo, editorRepo, team } = await fullJourney();
    await ownerRepo.revokeMember(team.id, EDITOR);

    await expect(
      editorRepo.saveSession(makeSession({ teamId: team.id, revision: 1 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('una revisión stale de la sesión se rechaza con revision_conflict y no muta nada', async () => {
    const { editorRepo, team } = await fullJourney();
    await expect(
      editorRepo.saveSession(makeSession({ teamId: team.id, revision: 99 })),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
  });
});

// =============================================================================
// 3 · PUERTA DE ACCESO / GUARDS (el cliente decide a dónde dirigir según estado)
// =============================================================================

describe('T4 multiuser — resolución de acceso (decideAccess) sobre el estado real', () => {
  it('sin sesión → unauthenticated, sin email codificado', async () => {
    // decideAccess(null) → no hay resolución; nunca depende de email.
    const target = decideAccess(null);
    expect(target.state).toBe('unauthenticated');
    expect(target.route).toBe('/auth/login');
  });

  it('un perfil aprobado sin equipo ni invitaciones SOLO llega a SOLICITAR equipo', async () => {
    const res: AccessResolution = {
      profile: {
        userId: FOREIGN,
        displayName: 'Luis',
        emailNormalized: 'foreign@example.com',
        status: 'approved',
        approvedAt: null,
      },
      ownedTeam: null,
      membership: null,
      pendingInvitations: [],
      teamRequest: null,
    };
    const target = decideAccess(res);
    // CAMBIO DE CONTRATO (22/09/2026): antes el estado era 'create-team' y la pantalla
    // creaba el equipo. El servidor ya no lo permite: se SOLICITA y lo aprueba un
    // administrador de plataforma. La ruta no cambia.
    expect(target.state).toBe('request-team');
    expect(target.route).toBe('/onboarding/team');
  });

  it('con una solicitud PENDIENTE el estado es request-pending (misma pantalla)', async () => {
    const res: AccessResolution = {
      profile: {
        userId: FOREIGN,
        displayName: 'Luis',
        emailNormalized: 'foreign@example.com',
        status: 'approved',
        approvedAt: null,
      },
      ownedTeam: null,
      membership: null,
      pendingInvitations: [],
      teamRequest: {
        id: 'req1',
        userId: FOREIGN,
        displayName: 'Luis',
        emailNormalized: 'foreign@example.com',
        name: 'Equipo de Luis',
        accentColor: '#3056d3',
        status: 'pending',
        note: null,
        requestedAt: nowIso(),
        decidedAt: null,
        createdTeamId: null,
      },
    };
    const target = decideAccess(res);
    expect(target.state).toBe('request-pending');
    expect(target.route).toBe('/onboarding/team');
  });

  it('un invitado (aprobado, sin equipo, con invitación pendiente) va a aceptar la invitación', async () => {
    const inv: TeamInvitationInfo = {
      id: 'i1',
      teamId: 't1',
      teamName: 'Primer',
      emailNormalized: 'editor@example.com',
      invitedUserId: EDITOR,
      status: 'pending',
      expiresAt: 'x',
      createdAt: 'y',
      emailStatus: 'created',
      emailAttempts: 0,
      lastEmailAt: null,
      lastEmailError: null,
    };
    const target = decideAccess({
      profile: {
        userId: EDITOR,
        displayName: 'Pedro',
        emailNormalized: 'editor@example.com',
        status: 'approved',
        approvedAt: null,
      },
      ownedTeam: null,
      membership: null,
      pendingInvitations: [inv],
      teamRequest: null,
    });
    expect(target.state).toBe('accept-invitation');
    expect(target.route).toBe('/invitations');
  });
});

// =============================================================================
// 4 · GATE DEL LLAMANTE: AccessService resuelve el estado y (solo si es 'ready')
//    conecta el repositorio al equipo en el StoreService.
// =============================================================================
// Estos tests ejercitan el repositorio real sobre un RlsBackend EN MEMORIA que
// simula las decisiones del servidor. No sustituyen la matriz SQL ejecutada
// contra PostgreSQL/Supabase; aquí se aísla la integración Angular.
// -----------------------------------------------------------------------------

function makeSupabase(backend: RlsBackend, userId: string) {
  const { client } = makeRlsClient(backend, userId);
  return {
    ensureResolved: vi.fn().mockResolvedValue(undefined),
    status: () => 'authenticated',
    user: () => ({ id: userId }),
    getClient: vi.fn().mockResolvedValue(client),
  };
}

function makeStore() {
  return {
    connectDataSource: vi.fn().mockResolvedValue(undefined),
    activateRemoteTeam: vi.fn(),
    resetToLocal: vi.fn(),
  };
}

describe('T4 multiuser — AccessService (gate al entrar al equipo)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('un editor ACTIVO resuelve a `ready` y conecta el repositorio al equipo', async () => {
    const { backend, team } = await fullJourney();
    const supabase = makeSupabase(backend, EDITOR);
    const store = makeStore();
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StoreService, useValue: store },
      ],
    });
    const service = TestBed.inject(AccessService);

    const target = await service.resolve();
    expect(target.state).toBe('ready');
    expect(target.teamId).toBe(team.id);
    expect(target.role).toBe('editor');
    // La carga lleva una guarda para descartar respuestas de una sesión ya cerrada.
    expect(store.connectDataSource).toHaveBeenCalledWith(
      expect.anything(),
      team.id,
      expect.any(Function),
    );
  });

  it('un invitado SIN aceptar resuelve a `accept-invitation` y NO conecta ningún equipo', async () => {
    const { backend, team } = await invitedEditorScenario();
    const supabase = makeSupabase(backend, EDITOR);
    const store = makeStore();
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StoreService, useValue: store },
      ],
    });
    const service = TestBed.inject(AccessService);

    const target = await service.resolve();
    expect(target.state).toBe('accept-invitation');
    expect(target.route).toBe('/invitations');
    expect(store.connectDataSource).not.toHaveBeenCalled();
  });

  // El equipo puede desaparecer ENTRE `resolveAccess` y la carga del dataset (el propietario lo
  // borra, el administrador revoca el acceso…). `connectDataSource` rechaza entonces a propósito
  // —hidratar una pizarra vacía como si el equipo existiera es peor— y la resolución que teníamos
  // queda obsoleta. Antes ese rechazo caía en el catch genérico de la inicialización: el usuario,
  // con sesión válida, aparecía en la pantalla de LOGIN sin explicación y sin camino a «solicitar
  // equipo». Ahora se vuelve a resolver el acceso, que es lo que dice la verdad.
  it('si el equipo resuelto ya no se puede cargar, vuelve a resolver el acceso (no echa al login)', async () => {
    const { backend, team } = await fullJourney();
    const supabase = makeSupabase(backend, EDITOR);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore();
    store.connectDataSource.mockRejectedValueOnce(
      new Error('El equipo ya no existe o no tienes acceso.'),
    );
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StoreService, useValue: store },
      ],
    });
    const service = TestBed.inject(AccessService);

    const target = await service.resolve();

    expect(store.connectDataSource).toHaveBeenCalledTimes(2);
    expect(target.state, 'la segunda resolución sí tiene equipo').toBe('ready');
    expect(target.teamId).toBe(team.id);
    expect(service.isReady()).toBe(true);
    expect(
      store.resetToLocal,
      'la sesión sigue siendo válida: NO se vuelve a modo local',
    ).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('si el equipo tampoco carga al reintentar, avisa UNA vez y no se queda en bucle', async () => {
    const { backend } = await fullJourney();
    const supabase = makeSupabase(backend, EDITOR);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore();
    store.connectDataSource.mockRejectedValue(
      new Error('El equipo ya no existe o no tienes acceso.'),
    );
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StoreService, useValue: store },
      ],
    });
    const service = TestBed.inject(AccessService);

    const target = await service.resolve();

    expect(store.connectDataSource, 'un único reintento, nunca un bucle').toHaveBeenCalledTimes(2);
    expect(target.state).toBe('unauthenticated');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });
});

// =============================================================================
// T5 · GESTIÓN de cuentas y pertenencia (migración 20260923000000)
//     Salir de un equipo, traspasar la propiedad y BORRAR una cuenta.
//     El backend simulado replica las guardas de las RPC (y la falta de política de
//     borrado directo sobre las tablas de identidad).
// =============================================================================

/** Escenario con equipo del propietario y un editor ACTIVO ya dentro. */
async function equipoConEditorActivo() {
  const hecho = await fullJourney();
  return hecho; // { backend, ownerRepo, editorRepo, team, ... }
}

describe('T5 multiuser — salir de un equipo', () => {
  it('un EDITOR ACTIVO puede salir: su membresía queda revoked y deja de tener equipo', async () => {
    const { backend, ownerRepo, editorRepo, team } = await equipoConEditorActivo();

    await editorRepo.leaveTeam(team.id);
    const fila = backend.rows.team_members.find(
      (m) => m.team_id === team.id && m.user_id === EDITOR,
    )!;
    expect(fila.status).toBe('revoked');
    expect(fila.accepted_at).toBeNull();

    // Ya no pertenece a ningún equipo: el guard lo llevará a solicitar/invitaciones.
    const acceso = await editorRepo.resolveAccess();
    expect(acceso.membership).toBeNull();
    expect(acceso.ownedTeam).toBeNull();

    // Y el propietario sigue siendo el propietario (no se ha tocado nada más).
    expect(await ownerRepo.listMembers(team.id)).toContainEqual(
      expect.objectContaining({ userId: OWNER, role: 'owner' }),
    );
  });

  it('el PROPIETARIO no puede salir (dejaría el equipo sin dueño): owner_cannot_leave', async () => {
    const { backend, ownerRepo, team } = await equipoConEditorActivo();

    await expect(ownerRepo.leaveTeam(team.id)).rejects.toMatchObject({
      code: 'owner_cannot_leave',
    });
    // Sigue siendo miembro activo y propietario.
    const fila = backend.rows.team_members.find(
      (m) => m.team_id === team.id && m.user_id === OWNER,
    )!;
    expect(fila.status).toBe('active');
    expect(backend.rows.teams.find((t) => t.id === team.id)!.owner_user_id).toBe(OWNER);
  });

  it('quien no es miembro activo no puede «salir»: not_a_member', async () => {
    const { backend, team } = await equipoConEditorActivo();
    const ajenoRepo = makeRepo(backend, FOREIGN, null);

    await expect(ajenoRepo.leaveTeam(team.id)).rejects.toMatchObject({ code: 'not_a_member' });
  });

  it('un no aprobado tampoco: profile_not_approved', async () => {
    const { backend, team } = await equipoConEditorActivo();
    const pendienteRepo = makeRepo(backend, PENDING, null);

    await expect(pendienteRepo.leaveTeam(team.id)).rejects.toMatchObject({
      code: 'profile_not_approved',
    });
  });
});

describe('T5 multiuser — traspasar la propiedad del equipo', () => {
  it('solo el PROPIETARIO puede traspasar: un editor recibe forbidden', async () => {
    const { editorRepo, team } = await equipoConEditorActivo();

    await expect(editorRepo.transferTeamOwnership(team.id, EDITOR)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('el traspaso cambia los DOS roles y el propietario, sin añadir ni quitar cuentas', async () => {
    const { backend, ownerRepo, editorRepo, team } = await equipoConEditorActivo();
    const cuentasAntes = backend.rows.team_members.filter((m) => m.team_id === team.id).length;

    await ownerRepo.transferTeamOwnership(team.id, EDITOR);

    expect(backend.rows.teams.find((t) => t.id === team.id)!.owner_user_id).toBe(EDITOR);
    const nuevoOwner = backend.rows.team_members.find(
      (m) => m.team_id === team.id && m.user_id === EDITOR,
    )!;
    const antiguoOwner = backend.rows.team_members.find(
      (m) => m.team_id === team.id && m.user_id === OWNER,
    )!;
    expect(nuevoOwner.role).toBe('owner');
    expect(nuevoOwner.status).toBe('active');
    expect(antiguoOwner.role).toBe('editor');
    expect(antiguoOwner.status).toBe('active');
    // Mismo número de cuentas en el equipo: se intercambian los papeles, no se crean plazas.
    expect(backend.rows.team_members.filter((m) => m.team_id === team.id)).toHaveLength(
      cuentasAntes,
    );

    // El acceso resuelto de cada uno cambia de rol, no de equipo.
    const accesoAntiguo = await ownerRepo.resolveAccess();
    expect(accesoAntiguo.ownedTeam).toBeNull();
    expect(accesoAntiguo.membership).toEqual({ teamId: team.id, role: 'editor' });
    const accesoNuevo = await editorRepo.resolveAccess();
    expect(accesoNuevo.ownedTeam?.id).toBe(team.id);

    // Y el que manda ahora es el nuevo propietario: el antiguo ya no puede revocar a nadie.
    await expect(ownerRepo.revokeMember(team.id, EDITOR)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('no se puede traspasar a quien no es miembro activo (ni a un revocado)', async () => {
    const { ownerRepo, team } = await equipoConEditorActivo();

    // Un usuario aprobado que no está en el equipo.
    await expect(ownerRepo.transferTeamOwnership(team.id, FOREIGN)).rejects.toMatchObject({
      code: 'new_owner_must_be_active_member',
    });
    // El propietario no puede traspasarse a sí mismo.
    await expect(ownerRepo.transferTeamOwnership(team.id, OWNER)).rejects.toMatchObject({
      code: 'already_owner',
    });
    // Un miembro revocado (se revoca primero al editor).
    await ownerRepo.revokeMember(team.id, EDITOR);
    await expect(ownerRepo.transferTeamOwnership(team.id, EDITOR)).rejects.toMatchObject({
      code: 'new_owner_must_be_active_member',
    });
  });

  it('no se puede traspasar a quien ya posee otro equipo (owner_user_id es único)', async () => {
    const { backend, ownerRepo, team } = await equipoConEditorActivo();
    // El extranjero se crea su propio equipo y ENTRA como editor en el equipo del propietario.
    const extranjero = await pedirYAprobarEquipo(backend, FOREIGN, 'Otro equipo');
    backend.seedPlayer(extranjero.id, { id: 'px', name: 'X' });
    const inv = await ownerRepo.inviteMember(team.id, 'foreign@example.com');
    await makeRepo(backend, FOREIGN, null).acceptInvitation(inv.id);

    await expect(ownerRepo.transferTeamOwnership(team.id, FOREIGN)).rejects.toMatchObject({
      code: 'new_owner_already_has_team',
    });
  });

  it('no se puede traspasar a un perfil NO aprobado', async () => {
    const { backend, ownerRepo, team } = await equipoConEditorActivo();
    // El editor entra, y después se suspende su perfil (el administrador puede hacerlo).
    const fila = backend.rows.profiles.find((p) => p.user_id === EDITOR)!;
    fila.status = 'suspended';

    await expect(ownerRepo.transferTeamOwnership(team.id, EDITOR)).rejects.toMatchObject({
      code: 'new_owner_not_approved',
    });
  });
});

describe('T5 multiuser — borrar una cuenta (solo el administrador, con guardas)', () => {
  it('un usuario normal no puede ni mirar la vista previa ni borrar', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);

    await expect(repo.accountDeletionPreview(PENDING)).rejects.toMatchObject({
      code: 'platform_admin_required',
    });
    await expect(repo.deleteAccount(PENDING, null)).rejects.toMatchObject({
      code: 'platform_admin_required',
    });
    // Y el perfil sigue ahí.
    expect(backend.rows.profiles.some((p) => p.user_id === PENDING)).toBe(true);
  });

  it('la vista previa explica qué se borraría y qué lo bloquea', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);

    // Cuenta normal sin equipo: se puede borrar.
    const normal = await adminRepo.accountDeletionPreview(FOREIGN);
    expect(normal).toMatchObject({ found: true, deletable: true, blockers: [] });
    expect(normal.emailNormalized).toBe('foreign@example.com');

    // Cuenta que POSEE un equipo: bloqueada, y con los números de lo que se llevaría.
    const team = await pedirYAprobarEquipo(backend, OWNER, 'Equipo con datos');
    backend.seedPlayer(team.id, { id: 'p1', name: 'Uno' });
    backend.seedExercise(team.id, { id: 'e1', title: 'Ejercicio' });
    const conEquipo = await adminRepo.accountDeletionPreview(OWNER);
    expect(conEquipo.deletable).toBe(false);
    expect(conEquipo.blockers).toContain('owns_team');
    expect(conEquipo.ownedTeamName).toBe('Equipo con datos');
    expect(conEquipo.ownedTeamData.players).toBe(1);
    expect(conEquipo.ownedTeamData.exercises).toBe(1);

    // Su propia cuenta y la de otro administrador también están bloqueadas.
    expect((await adminRepo.accountDeletionPreview(ADMIN)).blockers).toContain('self');
    backend.addProfile(
      '00000000-0000-0000-0000-0000000000ae',
      'Otro admin',
      'otro-admin@example.com',
      'approved',
    );
    backend.addPlatformAdmin('00000000-0000-0000-0000-0000000000ae');
    const otroAdmin = await adminRepo.accountDeletionPreview(
      '00000000-0000-0000-0000-0000000000ae',
    );
    expect(otroAdmin.blockers).toContain('platform_admin');
    expect(otroAdmin.deletable).toBe(false);
  });

  it('las guardas del servidor rechazan el borrado (uno mismo, otro admin, con equipo)', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);
    await pedirYAprobarEquipo(backend, OWNER, 'Equipo del propietario');
    backend.addProfile(
      '00000000-0000-0000-0000-0000000000ae',
      'Otro admin',
      'otro-admin@example.com',
      'approved',
    );
    backend.addPlatformAdmin('00000000-0000-0000-0000-0000000000ae');

    await expect(adminRepo.deleteAccount(ADMIN, null)).rejects.toMatchObject({
      code: 'cannot_delete_self',
    });
    await expect(
      adminRepo.deleteAccount('00000000-0000-0000-0000-0000000000ae', null),
    ).rejects.toMatchObject({ code: 'cannot_delete_platform_admin' });
    await expect(adminRepo.deleteAccount(OWNER, null)).rejects.toMatchObject({
      code: 'target_owns_team',
    });
    // Nadie ha desaparecido.
    expect(backend.rows.profiles).toHaveLength(7);
    expect(backend.rows.account_deletions).toHaveLength(0);
  });

  it('borra la cuenta de verdad (perfil + membresías) y deja el registro de auditoría', async () => {
    const { backend, team } = await equipoConEditorActivo();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);

    await adminRepo.deleteAccount(EDITOR, 'Se va del club');

    // El perfil y sus membresías ya no están.
    expect(backend.rows.profiles.some((p) => p.user_id === EDITOR)).toBe(false);
    expect(backend.rows.team_members.some((m) => m.user_id === EDITOR)).toBe(false);
    // El equipo y sus datos siguen intactos (solo se va una persona).
    expect(backend.rows.teams.some((t) => t.id === team.id)).toBe(true);
    expect(backend.rows.players.some((p) => p.team_id === team.id)).toBe(true);
    // Y queda el registro: quién, su correo, el motivo y quién lo hizo.
    expect(backend.rows.account_deletions).toHaveLength(1);
    expect(backend.rows.account_deletions[0]).toMatchObject({
      deleted_user_id: EDITOR,
      email_normalized: 'editor@example.com',
      status_before: 'approved',
      reason: 'Se va del club',
      deleted_by: ADMIN,
    });
  });

  it('el borrado NO es una vía alternativa desde el cliente: `profiles` no se puede borrar por tabla', async () => {
    const { backend } = setupJourney();
    conAdmin(backend);

    // El administrador autenticado lo intenta por la vía directa (como haría un navegador
    // malicioso con PostgREST): la RLS no tiene política de DELETE para `profiles`.
    const porTabla = await backend.tableQuery('profiles', ADMIN).delete();
    expect(porTabla.error).not.toBeNull();
    expect(backend.rows.profiles).toHaveLength(6);
  });

  it('el cliente no expone ningún método para borrar cuentas sin pasar por la RPC guardada', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, ADMIN, null) as unknown as Record<string, unknown>;
    for (const nombre of ['purgeAccount', 'deleteProfile', 'removeAccount']) {
      expect(repo[nombre], `el cliente no debe exponer ${nombre}`).toBeUndefined();
    }
  });
});

describe('T5 multiuser — eliminar un equipo', () => {
  it('la vista previa solo la ven el propietario o un administrador; un miembro no puede borrar', async () => {
    const { backend, ownerRepo, team } = await equipoConEditorActivo();
    backend.seedExercise(team.id, { id: 'ex-borrar', title: 'Ejercicio que desaparece' });

    const preview = await ownerRepo.teamDeletionPreview(team.id);
    expect(preview).toMatchObject({ found: true, canDelete: true, isOwner: true });
    expect(preview.confirmNameRequired).toBe(preview.name);
    // El escenario base ya trae 1 jugador, 1 carpeta, 1 ejercicio y 1 sesión; aquí se añade otro.
    expect(preview.data.players).toBe(1);
    expect(preview.data.folders).toBe(1);
    expect(preview.data.exercises).toBe(2);
    expect(preview.data.sessions).toBe(1);
    expect(preview.data.members).toBe(2);

    // Un miembro que NO es propietario no puede ni ver el resumen destructivo ni borrar.
    const editorRepo = makeRepo(backend, EDITOR, team.id);
    await expect(editorRepo.teamDeletionPreview(team.id)).rejects.toMatchObject({
      code: 'not_authorized_for_team_deletion',
    });
    await expect(editorRepo.deleteTeam(team.id, preview.name, null)).rejects.toMatchObject({
      code: 'not_authorized_for_team_deletion',
    });
    // Y un ajeno tampoco.
    const ajeno = makeRepo(backend, FOREIGN, null);
    await expect(ajeno.teamDeletionPreview(team.id)).rejects.toMatchObject({
      code: 'not_authorized_for_team_deletion',
    });
    await expect(ajeno.deleteTeam(team.id, preview.name, null)).rejects.toMatchObject({
      code: 'not_authorized_for_team_deletion',
    });
    // El equipo sigue ahí con sus datos.
    expect(backend.rows.teams.some((t) => t.id === team.id)).toBe(true);
    expect(backend.rows.exercises.some((e) => e.id === 'ex-borrar')).toBe(true);
  });

  it('la confirmación por nombre la comprueba el SERVIDOR (no la pantalla)', async () => {
    const { backend, ownerRepo, team } = await equipoConEditorActivo();

    await expect(ownerRepo.deleteTeam(team.id, '', null)).rejects.toMatchObject({
      code: 'team_name_confirmation_mismatch',
    });
    await expect(ownerRepo.deleteTeam(team.id, 'Otro nombre', null)).rejects.toMatchObject({
      code: 'team_name_confirmation_mismatch',
    });
    // Nada se ha borrado ni auditado.
    expect(backend.rows.teams.some((t) => t.id === team.id)).toBe(true);
    expect(backend.rows.team_deletions).toHaveLength(0);
  });

  it('con el nombre correcto borra el equipo y TODO lo suyo, y deja auditoría', async () => {
    const { backend, ownerRepo, editorRepo, team } = await equipoConEditorActivo();
    backend.seedExercise(team.id, { id: 'ex-1', title: 'Uno' });
    const nombre = (await ownerRepo.teamDeletionPreview(team.id)).confirmNameRequired;

    await ownerRepo.deleteTeam(team.id, nombre, 'Prueba de borrado');

    expect(backend.rows.teams.some((t) => t.id === team.id)).toBe(false);
    for (const tabla of ['players', 'exercise_folders', 'exercises', 'sessions'] as const) {
      expect(
        backend.rows[tabla].some((r) => r.team_id === team.id),
        `${tabla} debería haberse borrado`,
      ).toBe(false);
    }
    expect(backend.rows.team_members.some((m) => m.team_id === team.id)).toBe(false);
    expect(backend.rows.team_invitations.some((i) => i.team_id === team.id)).toBe(false);
    // Auditoría con el resumen y el motivo.
    expect(backend.rows.team_deletions).toHaveLength(1);
    expect(backend.rows.team_deletions[0]).toMatchObject({
      deleted_team_id: team.id,
      reason: 'Prueba de borrado',
      deleted_by: OWNER,
    });
    // El propietario se queda SIN equipo (podrá solicitar otro) y el editor pierde la pertenencia.
    const accesoOwner = await ownerRepo.resolveAccess();
    expect(accesoOwner.ownedTeam).toBeNull();
    expect(accesoOwner.membership).toBeNull();
    const accesoEditor = await editorRepo.resolveAccess();
    expect(accesoEditor.membership).toBeNull();
  });

  it('un administrador de plataforma también puede borrarlo (soporte), con el nombre escrito', async () => {
    const { backend, team } = await equipoConEditorActivo();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);

    const preview = await adminRepo.teamDeletionPreview(team.id);
    expect(preview).toMatchObject({ canDelete: true, isPlatformAdmin: true, isOwner: false });
    await expect(adminRepo.deleteTeam(team.id, 'nombre equivocado', null)).rejects.toMatchObject({
      code: 'team_name_confirmation_mismatch',
    });
    await adminRepo.deleteTeam(team.id, preview.confirmNameRequired, null);
    expect(backend.rows.teams.some((t) => t.id === team.id)).toBe(false);
    expect(backend.rows.team_deletions[0]).toMatchObject({ deleted_by: ADMIN });
  });

  it('la auditoría de equipos solo la lee el administrador (y no se escribe desde el cliente)', async () => {
    const { backend, ownerRepo, team } = await equipoConEditorActivo();
    const nombre = (await ownerRepo.teamDeletionPreview(team.id)).confirmNameRequired;
    await ownerRepo.deleteTeam(team.id, nombre, null);

    // El propietario que lo borró NO puede leer la tabla de auditoría (es del administrador).
    const lectura = (await backend.tableQuery('team_deletions', OWNER).select()) as {
      data?: Rw[] | null;
    };
    expect(lectura.data ?? []).toHaveLength(0);
    // Y un insert directo no es una vía alternativa.
    const porTabla = await backend
      .tableQuery('team_deletions', OWNER)
      .insert({ deleted_team_id: team.id, team_name: team.name });
    expect(porTabla.error).not.toBeNull();
  });
});

// =============================================================================
// T6 · PANEL CENTRAL DE ADMINISTRACIÓN (migraciones 20260928000000 y 20260923091218)
//     · El administrador ve los MIEMBROS de cualquier equipo (antes solo el propietario).
//     · El resumen global lo calcula el SERVIDOR en una consulta: recuentos de todos los equipos.
//     · Ni un editor normal ni un curioso sin sesión pueden pedir nada de esto.
// =============================================================================

describe('T6 multiuser — panel central: miembros de cualquier equipo y resumen global', () => {
  it('el administrador ve los miembros de un equipo que NO es suyo; un editor no', async () => {
    const { backend, team } = await equipoConEditorActivo();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);
    const editorRepo = makeRepo(backend, EDITOR, null);

    const miembros = await adminRepo.listMembers(team.id);
    expect(miembros.map((m) => m.emailNormalized).sort()).toEqual(
      ['editor@example.com', 'owner@example.com'].sort(),
    );

    // El editor sigue SIN poder listarlos: la lectura global es solo del administrador. El servidor
    // lanza `forbidden: not team owner` y el repositorio lo traduce al código de app `forbidden`.
    await expect(editorRepo.listMembers(team.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('el resumen global devuelve los recuentos de cada equipo y NO su contenido', async () => {
    const { backend, team } = await equipoConEditorActivo();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);

    const filas = await adminRepo.adminTeamOverview();
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila).toMatchObject({
      teamId: team.id,
      name: team.name,
      ownerEmail: 'owner@example.com',
      // El propietario y el editor activo: 2 miembros activos.
      membersActive: 2,
      invitationsPending: 0,
      folders: 1,
      exercises: 1,
      sessions: 1,
    });
    // El jugador es de verdad (lo sembró `fullJourney`): los recuentos no son inventados.
    expect(fila.playersActive).toBeGreaterThan(0);
    // Y son RECUENTOS: el objeto no arrastra ni un ejercicio ni una sesión.
    expect(Object.keys(fila)).not.toContain('exercises_data');
    expect(JSON.stringify(fila)).not.toContain('Rondos');
  });

  it('el resumen cuenta los estados por separado (activos, revocados, inactivos, invitaciones)', async () => {
    const { backend, team, editorRepo } = await equipoConEditorActivo();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);

    // El editor sale del equipo (pasa a `revoked`) y se le invita OTRA vez (invitación pendiente).
    await editorRepo.leaveTeam(team.id);
    await makeRepo(backend, OWNER, null).inviteMember(team.id, 'editor@example.com');
    backend.seedPlayer(team.id, {
      id: 'p-inactivo',
      name: 'Jugador antiguo',
      number: 15,
      position: 'DF',
      color: '#1a73e8',
      active: false,
    });

    const fila = (await adminRepo.adminTeamOverview())[0];
    expect(fila.membersActive).toBe(1); // solo el propietario
    expect(fila.membersRevoked).toBe(1); // el editor que se fue (histórico, no se borra)
    expect(fila.invitationsPending).toBe(1);
    expect(fila.playersInactive).toBe(1);
    expect(fila.playersActive).toBeGreaterThanOrEqual(1);
  });

  it('sin ser administrador de plataforma el resumen global se rechaza', async () => {
    const { ownerRepo } = await equipoConEditorActivo();
    // El PROPIETARIO del equipo no es administrador de plataforma.
    await expect(ownerRepo.adminTeamOverview()).rejects.toMatchObject({
      code: 'platform_admin_required',
    });
  });

  // CONSISTENCIA (migración 20260923154046): «Invitaciones pendientes» tiene que significar lo
  // mismo en el panel, en el contador de plazas del servidor y en la pantalla de Miembros.
  it('el resumen NO cuenta como pendiente una invitación caducada (la cuenta aparte)', async () => {
    const { backend, team } = await equipoConEditorActivo();
    conAdmin(backend);
    const adminRepo = makeRepo(backend, ADMIN, null);
    const ownerRepo = makeRepo(backend, OWNER, null);

    // Una invitación VIGENTE y otra ya CADUCADA en el mismo equipo.
    const vigente = await ownerRepo.inviteMember(team.id, 'vigente@example.com');
    const caducada = await ownerRepo.inviteMember(team.id, 'caducada@example.com');
    const filaCaducada = backend.rows.team_invitations.find((i) => i.id === caducada.id)!;
    filaCaducada.expires_at = new Date(Date.now() - 60_000).toISOString();

    const fila = (await adminRepo.adminTeamOverview())[0];
    expect(fila.invitationsPending, 'solo la vigente espera respuesta').toBe(1);
    expect(fila.invitationsExpiredPending, 'la caducada se cuenta aparte').toBe(1);

    // Y el límite de plazas del servidor aplica el MISMO criterio: cancelar la caducada no libera
    // una plaza, porque nunca la ocupó.
    const asientosAntes = await usedSeats(backend, team.id);
    await ownerRepo.cancelInvitation(caducada.id);
    const asientosDespues = await usedSeats(backend, team.id);
    expect(asientosDespues, 'una caducada no ocupaba plaza').toBe(asientosAntes);
    // La vigente sí: cancelarla libera una.
    await ownerRepo.cancelInvitation(vigente.id);
    expect(await usedSeats(backend, team.id)).toBe(asientosAntes - 1);
  });
});

/**
 * Plazas ocupadas según el criterio del SERVIDOR (`private.enforce_collaborator_limit`): editores
 * activos + invitaciones pendientes NO caducadas.
 */
async function usedSeats(backend: RlsBackend, teamId: string): Promise<number> {
  const ahora = Date.now();
  return (
    backend.rows.team_members.filter(
      (m) => m.team_id === teamId && m.status === 'active' && m.role !== 'owner',
    ).length +
    backend.rows.team_invitations.filter(
      (i) =>
        i.team_id === teamId && i.status === 'pending' && Date.parse(String(i.expires_at)) > ahora,
    ).length
  );
}
