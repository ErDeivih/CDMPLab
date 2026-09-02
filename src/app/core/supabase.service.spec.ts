import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthRedirectUrl, SUPABASE_CLIENT, SupabaseService } from './supabase.service';

interface MockAuth {
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  resend: ReturnType<typeof vi.fn>;
}

interface MockClient {
  auth: MockAuth;
  from: ReturnType<typeof vi.fn>;
}

function makeClient(opts?: {
  session?: { user: { id: string; email: string } } | null;
  signInError?: Error | null;
  signUpSession?: boolean;
  fromResult?: { data: Record<string, unknown> | null; error: Error | null };
}): MockClient {
  const client: MockClient = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: opts?.session ?? null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi
        .fn()
        .mockResolvedValue(
          opts?.signInError
            ? { data: { session: null }, error: opts.signInError }
            : { data: { session: opts?.session ?? null }, error: null }
        ),
      signUp: vi.fn().mockResolvedValue({ data: { session: opts?.signUpSession ? opts?.session ?? null : null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      resend: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
  } as unknown as MockClient;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(opts?.fromResult ?? { data: null, error: null }),
  };
  client.from.mockReturnValue(query);
  return client;
}

function provideClient(client: MockClient | null): void {
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE_CLIENT, useValue: Promise.resolve(client) }],
  });
}

describe('SupabaseService', () => {
  let service: SupabaseService;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('resuelve a `disabled` cuando el cliente es null (auth no configurada)', async () => {
    provideClient(null);
    service = TestBed.inject(SupabaseService);
    await service.ensureResolved();
    expect(service.status()).toBe('disabled');
    expect(service.session()).toBeNull();
  });

  it('resuelve a `authenticated` y guarda la sesión cuando hay sesión', async () => {
    const client = makeClient({ session: { user: { id: 'u1', email: 'a@b.c' } } });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    await service.ensureResolved();
    expect(service.status()).toBe('authenticated');
    expect(service.user()?.email).toBe('a@b.c');
  });

  it('resuelve a `unauthenticated` cuando no hay sesión', async () => {
    const client = makeClient({ session: null });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    await service.ensureResolved();
    expect(service.status()).toBe('unauthenticated');
    expect(service.session()).toBeNull();
  });

  it('signIn inicia sesión y deja el estado autenticado', async () => {
    const client = makeClient({ session: { user: { id: 'u1', email: 'a@b.c' } } });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    const res = await service.signIn('a@b.c', 'password123');
    expect(res.ok).toBe(true);
    expect(service.status()).toBe('authenticated');
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'password123' });
  });

  it('signIn devuelve un mensaje genérico sin revelar si el correo existe', async () => {
    const client = makeClient({ signInError: new Error('Invalid login credentials') });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    const res = await service.signIn('a@b.c', 'wrong');
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Correo o contraseña incorrectos.');
  });

  it('signUp pide verificación de correo cuando no devuelve sesión', async () => {
    const client = makeClient({ signUpSession: false });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    const res = await service.signUp('a@b.c', 'password123');
    expect(res.ok).toBe(true);
    expect(res.needsVerification).toBe(true);
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.c',
      password: 'password123',
      options: { emailRedirectTo: buildAuthRedirectUrl() },
    });
  });

  it('construye redirects bajo el base href de GitHub Pages, nunca en localhost', () => {
    const base = 'https://erdeivih.github.io/CDMPLab/';
    expect(buildAuthRedirectUrl('', base)).toBe(base);
    expect(buildAuthRedirectUrl('auth/update-password', base)).toBe(
      'https://erdeivih.github.io/CDMPLab/auth/update-password'
    );
  });

  it('signOut limpia la sesión y deja el estado unauthenticated', async () => {
    const client = makeClient({ session: { user: { id: 'u1', email: 'a@b.c' } } });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    await service.ensureResolved();
    const res = await service.signOut();
    expect(res.ok).toBe(true);
    expect(service.session()).toBeNull();
    expect(service.status()).toBe('unauthenticated');
  });

  it('resetPassword devuelve siempre el mensaje genérico (no revela el correo)', async () => {
    const client = makeClient();
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    const res = await service.resetPassword('a@b.c');
    expect(res.ok).toBe(true);
    expect(res.message).toBe('Si el correo existe, recibirás un enlace para restablecer tu contraseña.');
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.c', {
      redirectTo: buildAuthRedirectUrl('auth/update-password'),
    });
  });

  it('updatePassword delega en el cliente', async () => {
    const client = makeClient();
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    const res = await service.updatePassword('new-pass-123');
    expect(res.ok).toBe(true);
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass-123' });
  });

  it('resendConfirmation reenvía y aplica un cooldown', async () => {
    const client = makeClient();
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    const first = await service.resendConfirmation('a@b.c');
    expect(first.ok).toBe(true);
    expect(client.auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@b.c',
      options: { emailRedirectTo: buildAuthRedirectUrl() },
    });
    const second = await service.resendConfirmation('a@b.c');
    expect(second.ok).toBe(false);
    expect(second.message).toContain('Espera');
  });

  it('fetchProfile devuelve el perfil cuando el backend responde', async () => {
    const client = makeClient({
      session: { user: { id: 'u1', email: 'a@b.c' } },
      fromResult: { data: { user_id: 'u1', display_name: 'Ana', status: 'approved' }, error: null },
    });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    await service.ensureResolved();
    const profile = await service.fetchProfile();
    expect(profile?.status).toBe('approved');
    expect(profile?.displayName).toBe('Ana');
  });

  it('fetchProfile devuelve null si el backend no responde o la fila no existe', async () => {
    const client = makeClient({
      session: { user: { id: 'u1', email: 'a@b.c' } },
      fromResult: { data: null, error: null },
    });
    provideClient(client);
    service = TestBed.inject(SupabaseService);
    await service.ensureResolved();
    const profile = await service.fetchProfile();
    expect(profile).toBeNull();
  });
});
