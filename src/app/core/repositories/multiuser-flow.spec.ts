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
import { DataError } from './data-source';
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
    players: [],
    exercise_folders: [],
    exercises: [],
    sessions: [],
    session_exercises: [],
  };

  /** Registro: filtros de colección y llamadas RPC (para el test "sin email"). */
  readonly filters: Filter[] = [];
  readonly rpcCalls: Array<{ name: string; args: unknown; uid: string }> = [];
  readonly eqCalls: Array<{ table: string; col: string; val: unknown }> = [];

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

  isPlatformAdmin(_uid: string): boolean {
    // Sin admins en estos tests: la matriz multiusuario no la necesita.
    return false;
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
      table === 'team_invitations'
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

  async rpc(name: string, args: unknown, uid: string): Promise<RpcResult> {
    this.rpcCalls.push({ name, args, uid });
    const a = (args ?? {}) as Rw;
    switch (name) {
      case 'create_my_team':
        return this.rpcCreateMyTeam(a, uid);
      case 'invite_team_member':
        return this.rpcInvite(a, uid);
      case 'accept_team_invitation':
        return this.rpcAccept(a, uid);
      case 'my_team_invitations':
        return this.rpcMyInvitations(uid);
      case 'list_team_members':
        return this.rpcListMembers(a, uid);
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

  private rpcCreateMyTeam(a: Rw, uid: string): RpcResult {
    const name = String(a.p_name ?? '').trim();
    const color = String(a.p_accent_color ?? '');
    if (!this.isApproved(uid)) return err('42501', 'profile_not_approved');
    if (!name) return err('P0001', 'team_name_required');
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return err('P0001', 'invalid_accent_color');
    if (this.rows.teams.some((t) => t.owner_user_id === uid)) {
      return err('23505', 'duplicate key value violates unique constraint "teams_owner_unique"');
    }
    const id = uuid();
    const now = nowIso();
    this.rows.teams.push({
      id,
      owner_user_id: uid,
      name,
      accent_color: color,
      created_at: now,
      updated_at: now,
    });
    this.rows.team_members.push({
      team_id: id,
      user_id: uid,
      role: 'owner',
      status: 'active',
      invited_by: null,
      accepted_at: now,
      created_at: now,
    });
    return ok(id);
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
    if (!this.isTeamOwner(uid, teamId)) return err('P0001', 'forbidden: not team owner');
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
      const visible = this.selectRows(uid, table);
      const toDelete = applyFilters(visible);
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

function makeRlsClient(backend: RlsBackend, userId: string) {
  const rpcMock = vi.fn(async (name: string, args: unknown): Promise<RpcResult> =>
    backend.rpc(name, args, userId),
  );
  const fromMock = vi.fn((table: string): unknown => backend.tableQuery(table, userId));
  const client = { rpc: rpcMock, from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, rpcMock, fromMock, userId };
}

function makeRepo(backend: RlsBackend, userId: string, teamId: string | null): SupabaseRepository {
  const { client } = makeRlsClient(backend, userId);
  return new SupabaseRepository(client, userId, teamId);
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

/** Editor con una invitación pendiente (aún no aceptada) → estado accept-invitation. */
async function invitedEditorScenario() {
  const { backend } = setupJourney();
  const ownerRepo = makeRepo(backend, OWNER, null);
  const team = await ownerRepo.createTeam('Primer', '#3056d3');
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

  const team = await ownerRepo.createTeam('Primer Equipo', '#3056d3');
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
  it('el propietario crea su equipo (create_my_team), es suyo, y NO puede crear un segundo', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);

    const team = await repo.createTeam('Primer Equipo', '#3056d3');
    expect(team.id).toBeTruthy();
    expect(team.name).toBe('Primer Equipo');

    // El equipo es SUYO (derivado de auth.uid(), no del email).
    const access = await repo.resolveAccess();
    expect(access.ownedTeam?.id).toBe(team.id);
    expect(access.ownedTeam?.name).toBe('Primer Equipo');
    expect(access.membership).toBeNull();

    // Solo se permite UN equipo propio → el segundo createTeam es rechazado.
    await expect(repo.createTeam('Otro', '#ff0000')).rejects.toBeInstanceOf(DataError);
    expect(backend.rows.teams).toHaveLength(1);
  });

  it('el propietario invita a un usuario aprobado y la invitación se crea pendiente y con email_normalized', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await repo.createTeam('Primer', '#3056d3');

    const invitation = await repo.inviteMember(team.id, '  Editor@Example.com  ');
    expect(invitation.status).toBe('pending');
    expect(invitation.emailNormalized).toBe('editor@example.com'); // está normalizado (lower/trim)
    expect(invitation.teamId).toBe(team.id);
    expect(invitation.invitedUserId).toBe(EDITOR);
  });

  it('admite seis colaboradores pendientes además del propietario y rechaza el séptimo', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await repo.createTeam('Primer', '#3056d3');

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

  it('una invitación caducada no aparece como pendiente ni ocupa una plaza visual', async () => {
    const { backend } = setupJourney();
    const repo = makeRepo(backend, OWNER, null);
    const team = await repo.createTeam('Primer', '#3056d3');
    const invitation = await repo.inviteMember(team.id, 'caducado@example.com');
    const row = backend.rows.team_invitations.find((i) => i.id === invitation.id)!;
    row.expires_at = '2000-01-01T00:00:00.000Z';

    expect(await repo.listTeamInvitations(team.id)).toEqual([]);
    await expect(repo.inviteMember(team.id, 'vigente@example.com')).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('el invitado ve la invitación SIN pertenecer aún a un equipo (my_team_invitations)', async () => {
    const { backend } = setupJourney();
    const ownerRepo = makeRepo(backend, OWNER, null);
    const editorRepo = makeRepo(backend, EDITOR, null);
    const team = await ownerRepo.createTeam('Primer', '#3056d3');
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
    const team = await ownerRepo.createTeam('Primer', '#3056d3');
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
    expect(identityCols).toContain('owner_user_id'); // teams
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

  it('un perfil aprobado sin equipo ni invitaciones SOLO llega a crear equipo', async () => {
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
    };
    const target = decideAccess(res);
    expect(target.state).toBe('create-team');
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
    expect(store.connectDataSource).toHaveBeenCalledWith(expect.anything(), team.id);
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
});
