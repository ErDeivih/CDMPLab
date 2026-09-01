// =============================================================
// EntrenoLab — Servicio de acceso (autenticación + pertenencia a equipo)
//
// Orquesta el "login por estado": resuelve la sesión, el perfil, el equipo
// propio/membresía y las invitaciones, decide la pantalla de destino y CONECTA
// el repositorio Supabase con el StoreService. Es la única clase que, además
// del SupabaseService, sabe construir y conectar la fuente de datos real.
// =============================================================

import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { StoreService } from './store.service';
import { decideAccess, type AccessState, type AccessTarget } from './access';
import type { AccessResolution, DataSource, TeamInvitationInfo, TeamMemberInfo, ProfileStatus, ProfileInfo } from './repositories/data-source';
import { SupabaseRepository } from './repositories/supabase-data-source';
import type { Team } from './models';

@Injectable({ providedIn: 'root' })
export class AccessService {
  private readonly supabase = inject(SupabaseService);
  private readonly store = inject(StoreService);

  private readonly _state = signal<AccessState>('resolving');
  private readonly _resolution = signal<AccessResolution | null>(null);
  private readonly _target = computed(() => decideAccess(this._resolution()));
  private _repo: SupabaseRepository | null = null;
  private _initPromise: Promise<void> | null = null;

  readonly state = this._state.asReadonly();
  readonly target = this._target;
  readonly isResolving = computed(() => this._state() === 'resolving');

  /** Devuelve el repositorio activo (o null en modo local). */
  get activeDataSource(): DataSource | null {
    return this._repo;
  }

  /** Resuelve el acceso UNA sola vez (idempotente). Los guards lo esperan. */
  async resolve(): Promise<AccessTarget> {
    if (!this._initPromise) this._initPromise = this.initialize();
    await this._initPromise;
    return this._target();
  }

  /**
   * Vuelve a resolver el acceso desde cero (p. ej. tras iniciar sesión o
   * crear/entrar en un equipo). Devuelve el destino de acceso resultante.
   */
  async refresh(): Promise<AccessTarget> {
    this._initPromise = null;
    this._state.set('resolving');
    return this.resolve();
  }

  isReady(): boolean {
    return this._state() === 'ready';
  }

  /**
   * Verifica si el usuario es administrador de plataforma mediante la RPC real.
   * Retorna false si no hay sesión o el check falla; NUNCA decide por correo.
   */
  async checkIsPlatformAdmin(): Promise<boolean> {
    const repo = await this.ensureRepo();
    if (!repo) return false;
    try {
      return await repo.isPlatformAdmin();
    } catch {
      return false;
    }
  }

  // ---------- Inicialización ----------

  private async initialize(): Promise<void> {
    await this.supabase.ensureResolved();
    const status = this.supabase.status();
    if (status !== 'authenticated') {
      this._state.set(status === 'disabled' ? 'disabled' : 'unauthenticated');
      this._resolution.set(null);
      this.store.resetToLocal();
      return;
    }
    const client = await this.supabase.getClient();
    const userId = this.supabase.user()?.id ?? null;
    if (!client || !userId) {
      this._state.set('unauthenticated');
      this._resolution.set(null);
      this.store.resetToLocal();
      return;
    }
    try {
      const repo = new SupabaseRepository(client, userId, null);
      const res = await repo.resolveAccess();
      this._resolution.set(res);
      const target = decideAccess(res);
      this._state.set(target.state);
      if (target.state === 'ready' && target.teamId) {
        repo.setTeam(target.teamId);
        this._repo = repo;
        await this.store.connectDataSource(repo, target.teamId);
      } else {
        this._repo = repo; // disponible para acciones (crear equipo / aceptar invitación)
      }
    } catch (err) {
      console.error('[AccessService] no se pudo resolver el acceso', err);
      this._state.set('unauthenticated');
      this._resolution.set(null);
      this.store.resetToLocal();
    }
  }

  private async ensureRepo(): Promise<SupabaseRepository | null> {
    if (this._repo) return this._repo;
    await this.resolve();
    return this._repo;
  }

  // ---------- Acciones (equipo / colaboradores / admin) ----------

  /** Crea el equipo propio y conecta el repositorio a él. */
  async createTeam(name: string, accentColor: string): Promise<Team> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('El equipo solo puede crearse con sesión iniciada.');
    const team = await repo.createTeam(name, accentColor);
    repo.setTeam(team.id);
    this.store.activateRemoteTeam(repo, team);
    this._resolution.update((r) => (r ? { ...r, ownedTeam: team } : r));
    this._state.set('ready');
    return team;
  }

  /** Recarga los datos del equipo de contexto en el store. */
  async reloadTeamData() {
    const repo = this._repo;
    const teamId = repo?.teamId;
    if (!repo || !teamId) return;
    await this.store.connectDataSource(repo, teamId);
  }

  // ---------- Delegación (colaboradores / admin / invitaciones) ----------

  async listMembers(): Promise<TeamMemberInfo[]> {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) return [];
    return repo.listMembers(repo.teamId);
  }

  async listTeamInvitations(): Promise<TeamInvitationInfo[]> {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) return [];
    return repo.listTeamInvitations(repo.teamId);
  }

  async listInvitations(): Promise<TeamInvitationInfo[]> {
    const repo = await this.ensureRepo();
    // Precisamente los usuarios que todavía no pertenecen a un equipo son
    // quienes necesitan consultar esta lista para poder aceptar su invitación.
    if (!repo) return [];
    return repo.myPendingInvitations();
  }

  async inviteMember(email: string): Promise<TeamInvitationInfo> {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) throw new Error('No hay equipo de contexto.');
    const inv = await repo.inviteMember(repo.teamId, email);
    return inv;
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.cancelInvitation(invitationId);
  }

  async revokeMember(userId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) throw new Error('No hay equipo de contexto.');
    await repo.revokeMember(repo.teamId, userId);
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.acceptInvitation(invitationId);
    await this.refreshAfterMembershipChange();
  }

  async listProfiles(search: string): Promise<ProfileInfo[]> {
    const repo = await this.ensureRepo();
    if (!repo) return [];
    return repo.listProfiles(search);
  }

  /** Importa datos locales antiguos a Supabase de forma idempotente. */
  async importLocalData(data: {
    players: import('./models').Player[];
    folders: import('./models').ExerciseFolder[];
    exercises: import('./models').Exercise[];
    sessions: import('./models').Session[];
  }) {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) throw new Error('No hay equipo de contexto.');
    return repo.importLocalData(repo.teamId, data);
  }

  async setProfileStatus(userId: string, status: ProfileStatus): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.setProfileStatus(userId, status);
  }

  /**
   * Reinicia el estado tras aceptar una invitación (puede cambiar el equipo
   * de contexto): vuelve a resolver el acceso y reconecta.
   */
  async refreshAfterMembershipChange(): Promise<void> {
    this._initPromise = null;
    this._state.set('resolving');
    await this.resolve();
  }

  /** Cierra sesión: limpia el repositorio y vuelve el store a local. */
  async clear(): Promise<void> {
    this._repo = null;
    this._resolution.set(null);
    this._state.set('unauthenticated');
    this._initPromise = null;
    this.store.resetToLocal();
  }
}
