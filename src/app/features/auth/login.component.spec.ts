import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginComponent } from './login.component';
import { SupabaseService } from '../../core/supabase.service';
import { AccessService } from '../../core/access.service';

// =============================================================
// LOGIN — el destino (`?returnUrl=`) NO se pierde y nunca se sale de la app.
//
// POR QUÉ EXISTE ESTA PRUEBA (auditoría de flujos del 23/09/2026): el enlace del correo de
// invitación apunta a `/invitations?invitation=<uuid>`. Quien lo pulsaba sin sesión acababa en el
// login y, al entrar, aterrizaba en el destino genérico de su estado (su equipo): la invitación
// desaparecía de su vista porque `/invitations` no estaba en ninguna navegación. Ahora el login
// vuelve a donde iba el usuario… y solo acepta rutas INTERNAS: si aceptara una URL absoluta, el
// login sería un redirector abierto para llevar a la gente a otro dominio.
// =============================================================

async function montar(
  returnUrl: string | null,
  destinoPorEstado = '/team',
): Promise<{
  fixture: ComponentFixture<LoginComponent>;
  navigateByUrl: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
}> {
  TestBed.resetTestingModule();
  const navigateByUrl = vi.fn().mockResolvedValue(true);
  const refresh = vi.fn().mockResolvedValue({ state: 'ready', route: destinoPorEstado });
  await TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      {
        provide: SupabaseService,
        useValue: {
          signIn: vi.fn().mockResolvedValue({ ok: true }),
          user: () => ({ id: 'u1', email: 'a@b.c' }),
          isDevelopment: () => false,
          status: () => 'authenticated',
          ensureResolved: vi.fn().mockResolvedValue(undefined),
        },
      },
      { provide: AccessService, useValue: { refresh } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(returnUrl === null ? {} : { returnUrl }),
          },
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(LoginComponent);
  // El enrutador real se sustituye SOLO en `navigateByUrl`: interesa a dónde manda el login.
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(navigateByUrl);
  fixture.detectChanges();
  return { fixture, navigateByUrl, refresh };
}

/** Rellena el formulario y envía, como haría el usuario. */
async function entrar(fixture: ComponentFixture<LoginComponent>): Promise<void> {
  const componente = fixture.componentInstance as unknown as {
    form: { setValue(v: { email: string; password: string }): void };
    submit(): Promise<void>;
  };
  componente.form.setValue({ email: 'a@b.c', password: 'contrasena1' });
  await componente.submit();
}

describe('Login — el destino no se pierde al entrar', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('vuelve a la pantalla desde la que venía (invitación del correo)', async () => {
    const { fixture, navigateByUrl } = await montar('/invitations?invitation=abc');
    await entrar(fixture);
    expect(navigateByUrl).toHaveBeenCalledWith('/invitations?invitation=abc');
  });

  it('sin destino guardado va al destino que decide el estado', async () => {
    const { fixture, navigateByUrl } = await montar(null, '/onboarding/team');
    await entrar(fixture);
    expect(navigateByUrl).toHaveBeenCalledWith('/onboarding/team');
  });

  it('una URL EXTERNA en `returnUrl` se ignora (el login no es un redirector abierto)', async () => {
    for (const maliciosa of ['https://mal.example/robo', '//mal.example/robo']) {
      const { fixture, navigateByUrl } = await montar(maliciosa, '/team');
      await entrar(fixture);
      expect(navigateByUrl, maliciosa).toHaveBeenCalledWith('/team');
    }
  });

  it('no se acepta como destino otra pantalla de auth (evita bucles de login)', async () => {
    for (const auth of ['/auth/login', '/auth/register']) {
      const { fixture, navigateByUrl } = await montar(auth, '/team');
      await entrar(fixture);
      expect(navigateByUrl, auth).toHaveBeenCalledWith('/team');
    }
  });

  it('avisa de que volverá a donde iba, solo cuando hay destino', async () => {
    const conDestino = await montar('/invitations?invitation=abc');
    expect(conDestino.fixture.nativeElement.querySelector('[data-aviso-destino]')).toBeTruthy();

    const sinDestino = await montar(null);
    expect(sinDestino.fixture.nativeElement.querySelector('[data-aviso-destino]')).toBeNull();
  });
});
