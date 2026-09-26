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
import type {
  AccessResolution,
  AdminTeamOverview as AdminTeamOverviewRow,
  DataSource,
  TeamInvitationInfo,
  TeamMemberInfo,
  TeamRequestInfo,
  ProfileStatus,
  ProfileInfo,
} from './repositories/data-source';
import type { InviteEmailResult } from './invite-email';
import {
  missingDeletionPreview,
  missingTeamDeletionPreview,
  type AccountDeletionPreview,
  type TeamDeletionPreview,
} from './team-management';
import { SupabaseRepository } from './repositories/supabase-data-source';

export interface AdminOverview {
  /** Una fila por equipo, tal como las devuelve el servidor (recuentos y metadatos). */
  equipos: AdminTeamOverviewRow[];
  /** Suma de todos los equipos, para las tarjetas del resumen. */
  totals: {
    teams: number;
    membersActive: number;
    membersRevoked: number;
    membersPending: number;
    /** Pendientes que SÍ esperan respuesta (y ocupan plaza, igual que el límite del servidor). */
    invitationsPending: number;
    /** Pendientes ya caducadas: no ocupan plaza, pero bloquean reinvitar a ese correo. */
    invitationsExpiredPending: number;
    playersActive: number;
    playersInactive: number;
    folders: number;
    exercises: number;
    sessions: number;
  };
}

/** Suma un campo numérico de todas las filas. */
function sumar(
  filas: AdminTeamOverviewRow[],
  campo: (fila: AdminTeamOverviewRow) => number,
): number {
  return filas.reduce((total, fila) => total + campo(fila), 0);
}

@Injectable({ providedIn: 'root' })
export class AccessService {
  private readonly supabase = inject(SupabaseService);
  private readonly store = inject(StoreService);

  private readonly _state = signal<AccessState>('resolving');
  private readonly _resolution = signal<AccessResolution | null>(null);
  private readonly _target = computed(() => decideAccess(this._resolution()));
  private _repo: SupabaseRepository | null = null;
  private _initPromise: Promise<void> | null = null;
  private selectedTeamId: string | undefined;
  private sessionGeneration = 0;
  readonly switchingTeam = signal(false);
  readonly accessibleTeams = computed(() => this._resolution()?.accessibleTeams ?? []);

  readonly state = this._state.asReadonly();
  readonly target = this._target;
  readonly isResolving = computed(() => this._state() === 'resolving');
  /** Solicitud de equipo del usuario (null si no ha solicitado nada). */
  readonly teamRequest = computed(() => this._resolution()?.teamRequest ?? null);

  /**
   * Invitaciones PENDIENTES de la última resolución. La pantalla `/invitations` no estaba en
   * ninguna navegación: quien ya pertenecía a un equipo (o quien cerraba el aviso) no tenía
   * forma de volver a ver su invitación, aunque el propietario ya la hubiera enviado. La
   * navegación usa esto para ofrecer el enlace y contar cuántas quedan.
   */
  readonly pendingInvitations = computed(() => this._resolution()?.pendingInvitations ?? []);

  /**
   * ¿El SERVIDOR ha confirmado que esta cuenta administra la plataforma?
   *
   * Se resuelve UNA vez por arranque (una consulta barata a `is_platform_admin`) porque la
   * navegación necesita saberlo: antes el enlace «Administración» se ofrecía a cualquier
   * propietario de equipo y el `AdminGuard` lo devolvía a `/team` — un enlace que solo podía
   * acabar en rechazo. La barrera sigue siendo el servidor; esto evita OFRECER lo que va a
   * rechazar.
   */
  private readonly _platformAdmin = signal(false);
  readonly platformAdmin = this._platformAdmin.asReadonly();

  /** Devuelve el repositorio activo (o null en modo local). */
  get activeDataSource(): DataSource | null {
    return this._repo;
  }

  /** Resuelve el acceso UNA sola vez (idempotente). Los guards lo esperan. */
  async resolve(): Promise<AccessTarget> {
    // Primera pasada: si el equipo de la resolución ya no existe, todavía puede reintentarse
    // una vez (ver `initialize`).
    if (!this._initPromise) this._initPromise = this.initialize(true);
    await this._initPromise;
    return this._target();
  }

  /**
   * Vuelve a resolver el acceso desde cero (p. ej. tras iniciar sesión o
   * crear/entrar en un equipo). Devuelve el destino de acceso resultante.
   */
  async refresh(): Promise<AccessTarget> {
    this.sessionGeneration++;
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
   * Deja el resultado en `platformAdmin` para que la navegación y el panel no se contradigan.
   */
  async checkIsPlatformAdmin(): Promise<boolean> {
    const repo = await this.ensureRepo();
    if (!repo) {
      this._platformAdmin.set(false);
      return false;
    }
    try {
      const esAdmin = await repo.isPlatformAdmin();
      this._platformAdmin.set(esAdmin);
      return esAdmin;
    } catch {
      // Un resultado positivo anterior no puede sobrevivir a una recomprobación fallida.
      this._platformAdmin.set(false);
      return false;
    }
  }

  // ---------- Inicialización ----------

  /**
   * Resuelve sesión + perfil + pertenencia y, si el destino es `ready`, CONECTA el
   * repositorio al store.
   *
   * `reintentarSiElEquipoDesaparece` distingue la pasada normal (puede recuperarse de una
   * resolución obsoleta) de la de recuperación (ya no: si el equipo tampoco carga, se avisa).
   * Sin esa distinción el reintento sería infinito.
   */
  private async initialize(reintentarSiElEquipoDesaparece: boolean): Promise<void> {
    const generation = this.sessionGeneration;
    const current = () => generation === this.sessionGeneration;
    await this.supabase.ensureResolved();
    if (!current()) return;
    const status = this.supabase.status();
    if (status !== 'authenticated') {
      this._state.set(status === 'disabled' ? 'disabled' : 'unauthenticated');
      this._resolution.set(null);
      this._platformAdmin.set(false);
      this.store.resetToLocal();
      return;
    }
    const client = await this.supabase.getClient();
    if (!current()) return;
    const userId = this.supabase.user()?.id ?? null;
    if (!client || !userId) {
      this._state.set('unauthenticated');
      this._resolution.set(null);
      this._platformAdmin.set(false);
      this.store.resetToLocal();
      return;
    }
    try {
      const repo = new SupabaseRepository(client, userId, null);
      // Una consulta barata por arranque: la navegación necesita saber si ofrecer
      // «Administración» SIN ofrecer un enlace que el AdminGuard va a rechazar (ver
      // `platformAdmin`). Un fallo aquí NO bloquea el arranque: se queda en `false`.
      try {
        const admin = await repo.isPlatformAdmin();
        if (!current()) return;
        this._platformAdmin.set(admin);
      } catch {
        this._platformAdmin.set(false);
      }
      const res = await repo.resolveAccess();
      if (!current()) return;
      res.selectedTeamId = this.selectedTeamId;
      this._resolution.set(res);
      const target = decideAccess(res);
      this._state.set(target.state);
      if (target.state === 'ready' && target.teamId) {
        repo.setTeam(target.teamId);
        this._repo = repo;
        try {
          await this.store.connectDataSource(repo, target.teamId, current);
        } catch (err) {
          if (!current()) return;
          // `resolveAccess` dijo «ready» pero el equipo ya no está (borrado, salida del equipo o
          // acceso revocado entre las dos consultas): esa resolución está OBSOLETA. Antes el
          // fallo caía en el catch de abajo y el usuario —con sesión perfectamente válida—
          // acababa en la pantalla de login sin ninguna explicación, y desde ahí no había forma
          // de llegar a solicitar un equipo. Se vuelve a resolver UNA vez desde cero, que es lo
          // que devuelve el estado real (solicitar equipo, aceptar invitación…).
          if (!reintentarSiElEquipoDesaparece) throw err;
          console.warn(
            '[AccessService] el equipo resuelto ya no se pudo cargar; se vuelve a resolver el acceso',
            err,
          );
          this._repo = null;
          this._resolution.set(null);
          this._initPromise = null;
          this._initPromise = this.initialize(false);
          await this._initPromise;
        }
      } else {
        this._repo = repo; // disponible para acciones (crear equipo / aceptar invitación)
      }
    } catch (err) {
      if (!current()) return;
      console.error('[AccessService] no se pudo resolver el acceso', err);
      this._state.set('unauthenticated');
      this._resolution.set(null);
      this._platformAdmin.set(false);
      this.store.resetToLocal();
    }
  }

  private async ensureRepo(): Promise<SupabaseRepository | null> {
    if (this._repo) return this._repo;
    await this.resolve();
    return this._repo;
  }

  // ---------- Acciones (solicitud de equipo / colaboradores / admin) ----------

  /**
   * Presenta (o ACTUALIZA) la SOLICITUD de equipo del usuario.
   *
   * CAMBIO DE CONTRATO (22/09/2026): aquí vivía `createTeam`, que creaba el equipo al
   * instante llamando a `create_my_team`. El servidor ya no permite crear equipos a un
   * usuario aprobado: la solicitud queda pendiente y la aprueba un administrador de
   * plataforma, que es quien provoca la creación real dentro de la misma transacción.
   */
  async requestTeamCreation(name: string, accentColor: string): Promise<TeamRequestInfo> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('La solicitud de equipo necesita una sesión iniciada.');
    const request = await repo.requestTeamCreation(name, accentColor);
    this._resolution.update((r) => (r ? { ...r, teamRequest: request } : r));
    this._state.set(decideAccess(this._resolution()).state);
    return request;
  }

  /** Solicitud propia (o null). */
  async myTeamRequest(): Promise<TeamRequestInfo | null> {
    const repo = await this.ensureRepo();
    if (!repo) return null;
    return repo.myTeamRequest();
  }

  /** Cola de solicitudes de equipo. El servidor exige ser administrador de plataforma. */
  async listTeamRequests(search = ''): Promise<TeamRequestInfo[]> {
    const repo = await this.ensureRepo();
    if (!repo) return [];
    return repo.listTeamRequests(search);
  }

  /**
   * Aprueba una solicitud. El SERVIDOR crea el equipo en la misma transacción y la
   * operación es idempotente; devuelve el id del equipo (null si no lo hubo).
   */
  async approveTeamRequest(requestId: string): Promise<string | null> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    return repo.decideTeamRequest(requestId, true, null);
  }

  /** Rechaza una solicitud con un motivo (que el solicitante podrá leer). */
  async rejectTeamRequest(requestId: string, note: string | null): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.decideTeamRequest(requestId, false, note);
  }

  /**
   * Pide a la función de servidor que envíe el correo de una invitación. El envío real
   * vive en el servidor (la clave del proveedor es un secreto) y devuelve un estado
   * honesto: `provider_accepted` NO significa entregado.
   */
  async sendInvitationEmail(invitationId: string): Promise<InviteEmailResult> {
    return this.supabase.sendInvitationEmail(invitationId);
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

  /**
   * Rechazar la invitación PROPIA. Va por su propia RPC (`decline_team_invitation`):
   * `cancel_team_invitation` es del propietario del equipo y al invitado le
   * devolvía 'forbidden: not team owner'.
   */
  async declineInvitation(invitationId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.declineInvitation(invitationId);
  }

  async revokeMember(userId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) throw new Error('No hay equipo de contexto.');
    await repo.revokeMember(repo.teamId, userId);
  }

  async setMemberRole(userId: string, role: 'owner' | 'editor'): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo?.teamId) throw new Error('No hay equipo de contexto.');
    await repo.setTeamMemberRole(repo.teamId, userId, role);
    this.selectedTeamId = repo.teamId;
    await this.refreshAfterMembershipChange();
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    // Aceptar debe abrir el equipo invitado aunque ya se posean otros equipos.
    this.selectedTeamId = await repo.acceptInvitation(invitationId);
    await this.refreshAfterMembershipChange();
  }

  async listProfiles(search: string): Promise<ProfileInfo[]> {
    const repo = await this.ensureRepo();
    if (!repo) return [];
    return repo.listProfiles(search);
  }

  async listAdministrators(): Promise<string[]> {
    const repo = await this.ensureRepo();
    return repo ? repo.listAdministrators() : [];
  }

  async grantAdministrator(userId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.grantAdministrator(userId);
  }

  async deleteMyAdminAccount(email: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.deleteMyAdminAccount(email);
    await this.supabase.signOut();
    await this.clear();
  }

  async listAccessibleTeams(): Promise<import('./models').Team[]> {
    const repo = await this.ensureRepo();
    return repo ? repo.listAccessibleTeams() : [];
  }

  /**
   * Resumen global del panel de administración.
   *
   * CAMBIO DE CONTRATO (23/09/2026): antes se calculaba en el NAVEGADOR descargando el dataset
   * completo de cada equipo (`loadTeam` + `listMembers` por equipo) solo para contar filas: con N
   * equipos eso es N × todo el contenido, en cada visita al panel. Ahora lo calcula el servidor en
   * UNA consulta agregada (`admin_team_overview`), que además devuelve recuentos que el cliente no
   * podía deducir (invitaciones pendientes, jugadores inactivos, miembros revocados) y el correo
   * del propietario, sin traer ni un ejercicio ni una sesión.
   */
  async adminOverview(): Promise<AdminOverview> {
    const vacio: AdminOverview = {
      equipos: [],
      totals: {
        teams: 0,
        membersActive: 0,
        membersRevoked: 0,
        membersPending: 0,
        invitationsPending: 0,
        invitationsExpiredPending: 0,
        playersActive: 0,
        playersInactive: 0,
        folders: 0,
        exercises: 0,
        sessions: 0,
      },
    };
    const repo = await this.ensureRepo();
    if (!repo) return vacio;
    const equipos = await repo.adminTeamOverview();
    return {
      equipos,
      totals: {
        teams: equipos.length,
        membersActive: sumar(equipos, (e) => e.membersActive),
        membersRevoked: sumar(equipos, (e) => e.membersRevoked),
        membersPending: sumar(equipos, (e) => e.membersPending),
        invitationsPending: sumar(equipos, (e) => e.invitationsPending),
        invitationsExpiredPending: sumar(equipos, (e) => e.invitationsExpiredPending),
        playersActive: sumar(equipos, (e) => e.playersActive),
        playersInactive: sumar(equipos, (e) => e.playersInactive),
        folders: sumar(equipos, (e) => e.folders),
        exercises: sumar(equipos, (e) => e.exercises),
        sessions: sumar(equipos, (e) => e.sessions),
      },
    };
  }

  async openAdminTeam(teamId: string): Promise<void> {
    if (!(await this.checkIsPlatformAdmin()))
      throw new Error('Solo los administradores pueden acceder a todos los equipos.');
    return this.openTeam(teamId);
  }

  async openTeam(teamId: string): Promise<void> {
    if (this.switchingTeam()) throw new Error('Ya hay un cambio de equipo en curso.');
    if (this.store.pendingWrites() > 0 || this.store.lastError()) {
      throw new Error(
        'Espera a que terminen los cambios y resuelve cualquier error de guardado antes de cambiar de equipo.',
      );
    }
    this.switchingTeam.set(true);
    const generation = this.sessionGeneration;
    try {
      const client = await this.supabase.getClient();
      const userId = this.supabase.user()?.id;
      if (!client || !userId) throw new Error('No hay sesión.');
      const repo = new SupabaseRepository(client, userId, teamId);
      const teams = await repo.listTeamAccess();
      const team = teams.find((entry) => entry.id === teamId);
      if (!team) throw new Error('El equipo ya no existe o no está disponible.');
      const sessionStillCurrent = () =>
        this.supabase.user()?.id === userId && generation === this.sessionGeneration;
      await this.store.connectDataSource(repo, teamId, sessionStillCurrent);
      if (!sessionStillCurrent()) throw new Error('La sesión ha cambiado.');
      this._repo = repo;
      this.selectedTeamId = teamId;
      this._resolution.update((r) =>
        r
          ? {
              ...r,
              accessibleTeams: teams,
              selectedTeamId: teamId,
            }
          : r,
      );
      this._state.set('ready');
    } finally {
      this.switchingTeam.set(false);
    }
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

  /** Vista previa del borrado de una cuenta: qué se llevaría y qué lo impide. */
  async accountDeletionPreview(userId: string): Promise<AccountDeletionPreview> {
    const repo = await this.ensureRepo();
    if (!repo) return missingDeletionPreview(userId);
    return repo.accountDeletionPreview(userId);
  }

  /** BORRA una cuenta (solo administrador; las guardas están en el servidor). */
  async deleteAccount(userId: string, reason: string | null): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('No hay sesión.');
    await repo.deleteAccount(userId, reason);
    // El perfil borrado ya no puede aparecer en la lista del panel: se recargan los datos.
    await this.refresh();
  }

  /**
   * El propio miembro activo sale del equipo. Después hay que volver a resolver el acceso
   * (deja de tener equipo al que entrar) para que los guards no lo devuelvan a una pantalla
   * que ya no le corresponde.
   */
  async leaveTeam(teamId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo) throw new Error('Salir de un equipo necesita una sesión iniciada.');
    await repo.leaveTeam(teamId);
    await this.refreshAfterMembershipChange();
  }

  /** Traspaso de la propiedad: el propietario sigue con acceso, pero como editor. */
  async transferTeamOwnership(newOwnerUserId: string): Promise<void> {
    const repo = await this.ensureRepo();
    if (!repo || !repo.teamId) throw new Error('No hay equipo de contexto.');
    await repo.transferTeamOwnership(repo.teamId, newOwnerUserId);
    this.selectedTeamId = repo.teamId;
    await this.refreshAfterMembershipChange();
  }

  /** Cambia el nombre del equipo; la autorización real la aplica RLS en Supabase. */
  async renameTeam(name: string): Promise<void> {
    const repo = await this.ensureRepo();
    const team = this.store.activeTeam();
    if (!repo || !repo.teamId || !team) throw new Error('No hay equipo de contexto.');
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new Error('El nombre del equipo debe tener entre 2 y 80 caracteres.');
    }
    const updated = await repo.renameTeam(repo.teamId, trimmed, team.accentColor);
    this.store.updateTeam(updated);
    this._resolution.update((resolution) =>
      resolution
        ? {
            ...resolution,
            ownedTeam: resolution.ownedTeam?.id === updated.id ? updated : resolution.ownedTeam,
            accessibleTeams: resolution.accessibleTeams?.map((team) =>
              team.id === updated.id ? { ...team, ...updated } : team,
            ),
          }
        : resolution,
    );
  }

  /** Qué se borraría con el equipo de contexto (propietario o administrador). */
  async teamDeletionPreview(): Promise<TeamDeletionPreview> {
    const repo = await this.ensureRepo();
    const teamId = repo?.teamId;
    if (!repo || !teamId) return missingTeamDeletionPreview('');
    return repo.teamDeletionPreview(teamId);
  }

  /**
   * BORRA el equipo de contexto y todos sus datos. El nombre debe coincidir EXACTAMENTE (lo
   * comprueba el servidor). Después se vuelve a resolver el acceso: quien lo borró se queda sin
   * equipo y los guards lo llevarán a solicitar otro.
   */
  async deleteTeam(confirmName: string, reason: string | null): Promise<void> {
    const repo = await this.ensureRepo();
    const teamId = repo?.teamId;
    if (!repo || !teamId) throw new Error('No hay equipo de contexto.');
    await repo.deleteTeam(teamId, confirmName, reason);
    repo.setTeam(null);
    await this.refreshAfterMembershipChange();
  }

  /**
   * Reinicia el estado tras aceptar una invitación (puede cambiar el equipo
   * de contexto): vuelve a resolver el acceso y reconecta.
   */
  async refreshAfterMembershipChange(): Promise<void> {
    this.sessionGeneration++;
    this._initPromise = null;
    this._state.set('resolving');
    await this.resolve();
  }

  /** Cierra sesión: limpia el repositorio y vuelve el store a local. */
  async clear(): Promise<void> {
    this.sessionGeneration++;
    this.selectedTeamId = undefined;
    this._repo = null;
    this._resolution.set(null);
    this._state.set('unauthenticated');
    this._initPromise = null;
    // El permiso de administrador es de la SESIÓN: al cerrarla no puede sobrevivir en memoria
    // (si no, el siguiente usuario vería el enlace «Administración» sin serlo).
    this._platformAdmin.set(false);
    this.store.resetToLocal();
  }
}
