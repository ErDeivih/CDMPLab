// =============================================================
// Gestión de cuentas y pertenencia — reglas PURAS.
//
// Lo que se prueba aquí es lo que la interfaz decide ANTES de llamar al servidor: qué acción se
// ofrece y a quién, qué se explica en las confirmaciones de las acciones destructivas o de
// permisos, y cuándo la confirmación reforzada (escribir el correo) está completa. La
// autorización REAL vive en las RPC; esto evita ofrecer algo que el servidor va a rechazar y
// evita borrar sin decir qué se pierde.
// =============================================================

import { describe, expect, it } from 'vitest';
import {
  adminSelfDeletionConsequences,
  canDeleteAccount,
  canDeleteTeam,
  canLeaveTeam,
  canTransferOwnership,
  deletionBlockerMessage,
  deletionConfirmationMatches,
  deletionSummary,
  leaveTeamBlockedReason,
  leaveTeamConsequences,
  missingDeletionPreview,
  missingTeamDeletionPreview,
  teamDeletionConfirmMatches,
  teamDeletionConsequences,
  teamDeletionSummary,
  transferBlockedReason,
  transferConsequences,
  type AccountDeletionPreview,
  type TeamDeletionPreview,
  type TransferTarget,
} from './team-management';

function preview(overrides: Partial<AccountDeletionPreview> = {}): AccountDeletionPreview {
  return {
    found: true,
    userId: 'u1',
    displayName: 'Ana',
    emailNormalized: 'ana@example.com',
    status: 'approved',
    isPlatformAdmin: false,
    isSelf: false,
    ownsTeam: false,
    ownedTeamName: null,
    ownedTeamData: { players: 0, folders: 0, exercises: 0, sessions: 0 },
    activeMemberships: 0,
    pendingInvitations: 0,
    blockers: [],
    deletable: true,
    ...overrides,
  };
}

describe('borrado de cuentas — quién puede y qué se explica', () => {
  it('una cuenta normal sin equipo se puede borrar', () => {
    expect(canDeleteAccount(preview())).toBe(true);
  });

  it('sin vista previa (o con la cuenta ya borrada) NO se puede borrar', () => {
    expect(canDeleteAccount(null)).toBe(false);
    expect(canDeleteAccount(missingDeletionPreview('u9'))).toBe(false);
  });

  it('no se puede borrar la propia cuenta, ni un administrador, ni a quien posee un equipo', () => {
    expect(canDeleteAccount(preview({ blockers: ['self'], deletable: false, isSelf: true }))).toBe(
      false,
    );
    expect(
      canDeleteAccount(
        preview({ blockers: ['platform_admin'], deletable: false, isPlatformAdmin: true }),
      ),
    ).toBe(false);
    expect(
      canDeleteAccount(
        preview({
          blockers: ['owns_team'],
          deletable: false,
          ownsTeam: true,
          ownedTeamName: 'Primer Equipo',
        }),
      ),
    ).toBe(false);
  });

  it('cada bloqueo tiene su explicación en español, y ninguna promete deshacer', () => {
    expect(deletionBlockerMessage('self')).toContain('tu propia cuenta');
    expect(deletionBlockerMessage('platform_admin')).toContain('administrador');
    expect(deletionBlockerMessage('owns_team')).toContain('Traspasa');
    for (const b of ['self', 'platform_admin', 'owns_team'] as const) {
      expect(deletionBlockerMessage(b).toLowerCase()).not.toContain('recuperar');
    }
  });

  it('la confirmación reforzada exige el correo EXACTO (sin distinguir mayúsculas ni espacios)', () => {
    const p = preview({ emailNormalized: 'ana@example.com' });
    expect(deletionConfirmationMatches('ana@example.com', p.emailNormalized)).toBe(true);
    expect(deletionConfirmationMatches('  ANA@Example.COM ', p.emailNormalized)).toBe(true);
    expect(deletionConfirmationMatches('otra@example.com', p.emailNormalized)).toBe(false);
    expect(deletionConfirmationMatches('', p.emailNormalized)).toBe(false);
    expect(deletionConfirmationMatches('   ', p.emailNormalized)).toBe(false);
  });

  it('el resumen cuenta lo que se pierde y avisa de que no se puede deshacer', () => {
    const simple = deletionSummary(preview({ activeMemberships: 2, pendingInvitations: 1 }));
    expect(simple).toContain('2 equipos');
    expect(simple).toContain('1 invitación(es) pendiente(s)');
    expect(simple).toContain('No se puede deshacer');

    const conEquipo = deletionSummary(
      preview({
        ownsTeam: true,
        ownedTeamName: 'Primer Equipo',
        ownedTeamData: { players: 11, folders: 2, exercises: 5, sessions: 3 },
      }),
    );
    expect(conEquipo).toContain('Primer Equipo');
    expect(conEquipo).toContain('11 jugadores');
    expect(conEquipo).toContain('5 ejercicios');
    expect(conEquipo).toContain('NO se puede borrar');
  });
});

describe('salir de un equipo — solo el colaborador, y se explica qué se pierde', () => {
  it('un editor puede salir; el propietario no', () => {
    expect(canLeaveTeam('editor')).toBe(true);
    expect(canLeaveTeam('owner')).toBe(false);
    expect(canLeaveTeam(null)).toBe(false);
    expect(canLeaveTeam(undefined)).toBe(false);
  });

  it('el propietario recibe el motivo con la salida que sí existe (traspasar)', () => {
    const motivo = leaveTeamBlockedReason('owner');
    expect(motivo).toContain('propietario');
    expect(motivo).toContain('traspasa');
    expect(leaveTeamBlockedReason('editor')).toBeNull();
  });

  it('las consecuencias dicen qué se pierde y que hay que volver a ser invitado', () => {
    const texto = leaveTeamConsequences();
    expect(texto).toContain('jugadores');
    expect(texto).toContain('sesiones');
    expect(texto).toContain('cancelarán');
    expect(texto).toContain('volver a invitarte');
  });
});

describe('traspasar la propiedad — permisos y consecuencias', () => {
  const target = (over: Partial<TransferTarget> = {}): TransferTarget => ({
    userId: 'u2',
    displayName: 'Pedro',
    emailNormalized: 'pedro@example.com',
    role: 'editor',
    status: 'active',
    ...over,
  });

  it('solo el propietario actual puede, y solo a un editor ACTIVO distinto', () => {
    expect(canTransferOwnership('owner', target(), 'u1')).toBe(true);
    expect(canTransferOwnership('editor', target(), 'u1')).toBe(false);
    expect(canTransferOwnership(null, target(), 'u1')).toBe(false);
    expect(canTransferOwnership('owner', target({ userId: 'u1' }), 'u1')).toBe(false);
    expect(canTransferOwnership('owner', target({ status: 'pending_approval' }), 'u1')).toBe(false);
    expect(canTransferOwnership('owner', target({ status: 'revoked' }), 'u1')).toBe(false);
    expect(canTransferOwnership('owner', target({ role: 'owner' }), 'u1')).toBe(false);
    expect(canTransferOwnership('owner', null, 'u1')).toBe(false);
  });

  it('los motivos explican por qué no se puede', () => {
    expect(transferBlockedReason('editor', target(), 'u1')).toContain('Solo el propietario');
    expect(transferBlockedReason('owner', null, 'u1')).toContain('Elige');
    expect(transferBlockedReason('owner', target({ userId: 'u1' }), 'u1')).toContain('Ya eres');
    expect(transferBlockedReason('owner', target({ status: 'pending_approval' }), 'u1')).toContain(
      'todavía no ha aceptado',
    );
    expect(transferBlockedReason('owner', target({ role: 'owner' }), 'u1')).toContain(
      'colaborador',
    );
    expect(transferBlockedReason('owner', target(), 'u1')).toBeNull();
  });

  it('las consecuencias avisan de que el propietario baja a colaborador', () => {
    const texto = transferConsequences('Pedro');
    expect(texto).toContain('Pedro');
    expect(texto).toContain('propietario');
    expect(texto).toContain('colaborador');
    expect(texto).toContain('no podrás gestionar miembros');
    expect(texto).toContain('recuperar la propiedad');
  });
});

describe('eliminar un equipo — permiso, confirmación escrita y resumen', () => {
  const preview = (over: Partial<TeamDeletionPreview> = {}): TeamDeletionPreview => ({
    found: true,
    teamId: 't1',
    name: 'Primer Equipo',
    accentColor: '#3056d3',
    ownerUserId: 'u1',
    ownerEmail: 'ana@example.com',
    isOwner: true,
    isPlatformAdmin: false,
    canDelete: true,
    confirmNameRequired: 'Primer Equipo',
    data: { players: 11, folders: 2, exercises: 5, sessions: 3, members: 4, pendingInvitations: 1 },
    ...over,
  });

  it('solo se puede borrar cuando el servidor lo autoriza', () => {
    expect(canDeleteTeam(preview())).toBe(true);
    expect(canDeleteTeam(preview({ canDelete: false, isOwner: false }))).toBe(false);
    expect(canDeleteTeam(preview({ found: false }))).toBe(false);
    expect(canDeleteTeam(null)).toBe(false);
    expect(canDeleteTeam(missingTeamDeletionPreview('t9'))).toBe(false);
  });

  it('la confirmación exige el nombre del equipo (sin distinguir mayúsculas ni espacios)', () => {
    expect(teamDeletionConfirmMatches('Primer Equipo', 'Primer Equipo')).toBe(true);
    expect(teamDeletionConfirmMatches('  primer equipo ', 'Primer Equipo')).toBe(true);
    expect(teamDeletionConfirmMatches('Primer', 'Primer Equipo')).toBe(false);
    expect(teamDeletionConfirmMatches('', 'Primer Equipo')).toBe(false);
    expect(teamDeletionConfirmMatches('   ', 'Primer Equipo')).toBe(false);
  });

  it('el resumen cuenta lo que se destruye y avisa de que no se puede deshacer', () => {
    const texto = teamDeletionSummary(preview());
    expect(texto).toContain('Primer Equipo');
    expect(texto).toContain('11 jugador(es)');
    expect(texto).toContain('5 ejercicio(s)');
    expect(texto).toContain('1 invitación(es) pendiente(s)');
    expect(texto).toContain('No se puede deshacer');
    // Sin invitaciones pendientes no se menciona esa parte.
    const sinInvitaciones = teamDeletionSummary(
      preview({ data: { ...preview().data, pendingInvitations: 0 } }),
    );
    expect(sinInvitaciones).not.toContain('invitación');
  });

  it('las consecuencias dicen qué pasa con las personas y contigo', () => {
    const texto = teamDeletionConsequences();
    expect(texto).toContain('colaboradores perderán el acceso');
    expect(texto).toContain('su cuenta seguirá existiendo');
    expect(texto).toContain('podrás solicitar otro');
  });
});

describe('baja del propio administrador — se explica antes de escribir el correo', () => {
  it('avisa de que es definitiva y de que debe quedar otro administrador', () => {
    const texto = adminSelfDeletionConsequences();
    expect(texto).toContain('definitivamente');
    expect(texto).toContain('otra persona administradora');
    expect(texto).toContain('rechazará la baja');
  });

  it('avisa de que los equipos propios hay que traspasarlos antes, y que los ajenos siguen', () => {
    const texto = adminSelfDeletionConsequences();
    expect(texto).toContain('traspasar o eliminar los equipos');
    expect(texto).toContain('siguen existiendo');
  });

  it('la confirmación reforzada reutiliza la MISMA regla que el borrado de cuentas', () => {
    // El servidor compara `p_confirm_email` con el correo normalizado del perfil, así que la
    // pantalla usa la misma comparación (sin mayúsculas ni espacios de sobra) que en el borrado
    // de una cuenta ajena: una sola regla, no dos parecidas que se puedan separar.
    expect(deletionConfirmationMatches(' jefe@Example.com ', 'jefe@example.com')).toBe(true);
    expect(deletionConfirmationMatches('', 'jefe@example.com')).toBe(false);
    expect(deletionConfirmationMatches('otro@example.com', 'jefe@example.com')).toBe(false);
  });
});
