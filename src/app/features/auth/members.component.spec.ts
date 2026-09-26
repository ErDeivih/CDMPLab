import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../core/confirm.service';
import { AccessService } from '../../core/access.service';
import { StoreService } from '../../core/store.service';
import { SupabaseService } from '../../core/supabase.service';
import { MembersComponent } from './members.component';

describe('MembersComponent — invitaciones caducadas', () => {
  it('cuenta propietarios y editores, y añadir copropietario exige confirmar sin traspasar', async () => {
    const people = [
      { userId: 'owner', role: 'owner', displayName: 'Ana' },
      { userId: 'coowner', role: 'owner', displayName: 'Luis' },
      { userId: 'editor', role: 'editor', displayName: 'Eva' },
    ].map((member) => ({
      ...member,
      status: 'active',
      emailNormalized: `${member.userId}@example.com`,
    }));
    const access = {
      target: () => ({ role: 'owner', teamId: 't1' }),
      platformAdmin: () => false,
      listMembers: vi.fn().mockResolvedValue(people),
      listTeamInvitations: vi.fn().mockResolvedValue([]),
      setMemberRole: vi.fn().mockResolvedValue(undefined),
      transferTeamOwnership: vi.fn(),
    };
    const ask = vi.fn();
    TestBed.configureTestingModule({
      imports: [MembersComponent],
      providers: [
        { provide: AccessService, useValue: access },
        {
          provide: StoreService,
          useValue: { isRemote: () => true, activeTeam: () => ({ id: 't1', name: 'Equipo' }) },
        },
        { provide: SupabaseService, useValue: { user: () => ({ id: 'owner' }) } },
        { provide: ConfirmService, useValue: { ask } },
      ],
    });
    const fixture = TestBed.createComponent(MembersComponent);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('3 de 7 usadas');
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-accion="copropiedad"]'),
    ) as HTMLButtonElement[];
    expect(buttons).toHaveLength(3);
    expect(buttons[0].disabled).toBe(false);
    buttons[2].click();
    expect(access.setMemberRole).not.toHaveBeenCalled();
    const confirmation = ask.mock.calls[0][0];
    expect(confirmation.message).toContain('Tú conservarás tus permisos');
    confirmation.onConfirm();
    await fixture.whenStable();
    expect(access.setMemberRole).toHaveBeenCalledWith('editor', 'owner');
    expect(access.transferTeamOwnership).not.toHaveBeenCalled();
    access.listMembers.mockResolvedValue([people[0]]);
    await fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-accion="copropiedad"]').disabled).toBe(true);
  });

  it('mantiene visible el fallo de correo tras recargar y oculta el detalle técnico', async () => {
    const providerError =
      'We have detected you are using an unrecognised IP address 2a05:d012:fca:9508::1';
    const invitation = {
      id: 'inv-1',
      teamId: 'team-1',
      teamName: 'Juvenil B',
      emailNormalized: 'colaborador@example.com',
      invitedUserId: null,
      status: 'pending',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      emailStatus: 'send_error',
      emailAttempts: 1,
      lastEmailAt: null,
      lastEmailError: providerError,
    };
    const access = {
      target: vi.fn(() => ({ role: 'owner', teamId: 'team-1' })),
      platformAdmin: vi.fn(() => false),
      listMembers: vi.fn().mockResolvedValue([]),
      listTeamInvitations: vi.fn().mockResolvedValue([invitation]),
      sendInvitationEmail: vi.fn().mockResolvedValue({
        ok: false,
        status: 'send_error',
        message: 'No se pudo enviar el correo.',
      }),
    };
    TestBed.configureTestingModule({
      imports: [MembersComponent],
      providers: [
        { provide: AccessService, useValue: access },
        {
          provide: StoreService,
          useValue: {
            isRemote: () => true,
            activeTeam: () => ({ id: 'team-1', name: 'Juvenil B', accentColor: '#c8102e' }),
          },
        },
        { provide: SupabaseService, useValue: { user: () => ({ id: 'owner-1' }) } },
        { provide: ConfirmService, useValue: { ask: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MembersComponent);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector(
      '[data-invitacion="send_error"]',
    ) as HTMLElement;
    expect(row.textContent).toContain('IP no autorizada');
    expect(row.textContent?.match(/IP no autorizada/g)).toHaveLength(1);
    expect(row.querySelector('details')?.open).toBe(false);
    (row.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(access.sendInvitationEmail).toHaveBeenCalledWith('inv-1');
    expect(fixture.nativeElement.querySelector('.auth-msg.err')?.textContent).toContain(
      'IP no autorizada',
    );
  });

  it('las deja cancelar, no ofrece enviar/copiar y no las cuenta como plaza', async () => {
    const invitacion = {
      id: 'inv-expired',
      teamId: 'team-1',
      teamName: 'Juvenil B',
      emailNormalized: 'colaborador@example.com',
      invitedUserId: null,
      status: 'pending',
      expiresAt: '2000-01-01T00:00:00.000Z',
      createdAt: '1999-12-01T00:00:00.000Z',
      emailStatus: 'created',
      emailAttempts: 0,
      lastEmailAt: null,
      lastEmailError: null,
    };
    const access = {
      target: vi.fn(() => ({ role: 'owner', teamId: 'team-1' })),
      platformAdmin: vi.fn(() => false),
      listMembers: vi.fn().mockResolvedValue([]),
      listTeamInvitations: vi.fn().mockResolvedValue([invitacion]),
    };
    const store = {
      isRemote: vi.fn(() => false),
      activeTeam: vi.fn(() => ({ id: 'team-1', name: 'Juvenil B', accentColor: '#c8102e' })),
    };

    TestBed.configureTestingModule({
      imports: [MembersComponent],
      providers: [
        { provide: AccessService, useValue: access },
        { provide: StoreService, useValue: store },
        { provide: SupabaseService, useValue: { user: () => ({ id: 'owner-1' }) } },
        { provide: ConfirmService, useValue: { ask: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MembersComponent);
    fixture.detectChanges();
    // Angular inicia ngOnInit sin esperar su Promise; esperar una carga explícita evita leer la
    // pantalla mientras sigue mostrando «Cargando miembros…».
    await fixture.componentInstance.load();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('[data-expirada="true"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Invitación caducada');
    expect(row.textContent).toMatch(/no ocupa plaza/i);
    // Contrato nuevo: siete cuentas totales, incluidos los propietarios.
    expect(fixture.nativeElement.querySelector('.auth-row strong').textContent).toContain('0 de 7');
    expect(row.querySelector('button')?.textContent).toContain('Cancelar');
    expect(row.textContent).not.toContain('Copiar enlace');
    expect(row.textContent).not.toContain('Enviar por correo');
  });

  it('el administrador de plataforma consulta otro equipo sin recibir acciones de propietario', async () => {
    const access = {
      target: vi.fn(() => ({ role: 'editor', teamId: 'team-2' })),
      platformAdmin: vi.fn(() => true),
      listMembers: vi.fn().mockResolvedValue([
        {
          userId: 'owner-2',
          displayName: 'Mario',
          emailNormalized: 'owner@example.com',
          role: 'owner',
          status: 'active',
          acceptedAt: null,
          invitedBy: null,
        },
      ]),
      listTeamInvitations: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [MembersComponent],
      providers: [
        { provide: AccessService, useValue: access },
        {
          provide: StoreService,
          useValue: {
            isRemote: () => true,
            activeTeam: () => ({ id: 'team-2', name: 'Otro', accentColor: '#3056d3' }),
          },
        },
        { provide: SupabaseService, useValue: { user: () => ({ id: 'admin' }) } },
        { provide: ConfirmService, useValue: { ask: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MembersComponent);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Mario');
    expect(fixture.nativeElement.textContent).toContain('Vista de consulta');
    expect(fixture.nativeElement.querySelector('#invite-email')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-accion="traspasar-propiedad"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-accion="salir-equipo"]')).toBeNull();
    expect(access.listTeamInvitations).not.toHaveBeenCalled();
  });
});
