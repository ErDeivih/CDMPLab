import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AccessService } from '../../core/access.service';
import { ConfirmService } from '../../core/confirm.service';
import { SupabaseService } from '../../core/supabase.service';
import { AdminAccessComponent } from './admin-access.component';

async function mount(overviewFails = false) {
  const access = {
    checkIsPlatformAdmin: vi.fn().mockResolvedValue(true),
    listAdministrators: vi.fn().mockResolvedValue([]),
    adminOverview: overviewFails
      ? vi.fn().mockRejectedValue(new Error('Resumen no disponible'))
      : vi.fn().mockResolvedValue({ equipos: [], totals: { teams: 0 } }),
    listProfiles: vi.fn().mockResolvedValue([]),
    listTeamRequests: vi.fn().mockResolvedValue([]),
  };
  TestBed.configureTestingModule({
    imports: [AdminAccessComponent],
    providers: [
      provideRouter([]),
      { provide: AccessService, useValue: access },
      {
        provide: SupabaseService,
        useValue: { user: () => ({ id: 'admin', email: 'admin@example.com' }) },
      },
      { provide: ConfirmService, useValue: { ask: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(AdminAccessComponent);
  fixture.detectChanges();
  // La carga explícita evita dar por finalizado ngOnInit mientras Promise.allSettled sigue vivo.
  await (
    fixture.componentInstance as unknown as { loadAdministration(): Promise<void> }
  ).loadAdministration();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('Administración — cola y navegación', () => {
  it('los dos accesos de la cola desplazan y enfocan el apartado correcto', async () => {
    const fixture = await mount();
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.admin-jump'),
    ] as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    for (const [index, id] of ['cuentas', 'solicitudes-equipo'].entries()) {
      const heading = fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
      const scroll = vi.fn();
      heading.scrollIntoView = scroll;
      buttons[index].click();
      expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      expect(document.activeElement).toBe(heading);
    }
  });

  it('un error de estadísticas no oculta las cuentas ni las solicitudes al administrador', async () => {
    const fixture = await mount(true);
    expect(fixture.nativeElement.querySelector('[data-pendientes-admin]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Resumen no disponible');
    expect(fixture.nativeElement.querySelector('[data-apartado="cuentas"]')).toBeTruthy();
  });
});
