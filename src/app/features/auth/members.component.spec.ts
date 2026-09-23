import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../core/confirm.service';
import { AccessService } from '../../core/access.service';
import { StoreService } from '../../core/store.service';
import { SupabaseService } from '../../core/supabase.service';
import { MembersComponent } from './members.component';

describe('MembersComponent — invitaciones caducadas', () => {
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
    expect(fixture.nativeElement.querySelector('.auth-row strong').textContent).toContain('0 de 6');
    expect(row.querySelector('button')?.textContent).toContain('Cancelar');
    expect(row.textContent).not.toContain('Copiar enlace');
    expect(row.textContent).not.toContain('Enviar por correo');
  });
});
