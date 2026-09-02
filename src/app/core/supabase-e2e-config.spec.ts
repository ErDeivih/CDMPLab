import { describe, it, expect } from 'vitest';
import {
  cleanValue,
  parseCsvList,
  readEnv,
  missingRequiredVars,
  buildPrefix,
  skipReason,
  limitEmailsValid,
  REQUIRED_SUPABASE_E2E_VARS,
} from './supabase-e2e-config';

describe('supabase-e2e-config (helpers puros de la suite Supabase real)', () => {
  it('cleanValue: trima y trata el vacío como null', () => {
    expect(cleanValue('  x  ')).toBe('x');
    expect(cleanValue('')).toBe(null);
    expect(cleanValue('   ')).toBe(null);
    expect(cleanValue(undefined)).toBe(null);
    expect(cleanValue('a@b.com')).toBe('a@b.com');
  });

  it('parseCsvList: divide por comas y descarta vacíos', () => {
    expect(parseCsvList('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseCsvList(' a , b ')).toEqual(['a', 'b']);
    expect(parseCsvList('')).toEqual([]);
    expect(parseCsvList('a,,b,')).toEqual(['a', 'b']);
    expect(parseCsvList(undefined)).toEqual([]);
  });

  it('readEnv: normaliza todas las variables', () => {
    const env = readEnv({
      SUPABASE_E2E_ADMIN_EMAIL: 'admin@x.com',
      SUPABASE_E2E_LIMIT_EMAILS: 'c1@x.com, c2@x.com, c3@x.com, c4@x.com',
      SUPABASE_E2E_OWNER_PASSWORD: ' ',
    });
    expect(env.adminEmail).toBe('admin@x.com');
    expect(env.limitEmails).toEqual(['c1@x.com', 'c2@x.com', 'c3@x.com', 'c4@x.com']);
    expect(env.ownerPassword).toBe(null);
    expect(env.rejectedEmail).toBe(null);
  });

  it('missingRequiredVars: detecta solo las obligatorias ausentes', () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_E2E_ADMIN_EMAIL: 'a@x.com',
      SUPABASE_E2E_ADMIN_PASSWORD: 'p',
      SUPABASE_E2E_OWNER_EMAIL: 'o@x.com',
      SUPABASE_E2E_OWNER_PASSWORD: 'p',
      SUPABASE_E2E_COLLAB_EMAIL: 'c@x.com',
      SUPABASE_E2E_COLLAB_PASSWORD: 'p',
      // limit vars ausentes + pending/rejected ausentes (opcionales)
    };
    expect(missingRequiredVars(env)).toEqual(['SUPABASE_E2E_LIMIT_EMAILS', 'SUPABASE_E2E_LIMIT_PASSWORD']);
  });

  it('missingRequiredVars: lista todas si no hay ninguna', () => {
    expect(missingRequiredVars({})).toEqual([...REQUIRED_SUPABASE_E2E_VARS]);
  });

  it('buildPrefix: genera prefijos únicos y con la forma esperada', () => {
    const a = buildPrefix(1000, () => 0.5);
    const b = buildPrefix(2000, () => 0.25);
    expect(a).toMatch(/^e2e-[a-z0-9]+-[a-z0-9]{4}$/);
    expect(a).not.toBe(b);
    // Cambiar el "random" produce prefijos distintos.
    expect(buildPrefix(1000, () => 0.5)).not.toBe(buildPrefix(1000, () => 0.9));
  });

  it('skipReason: mensaje explícito con las variables ausentes', () => {
    expect(skipReason(['A', 'B'])).toContain('Variables de entorno ausentes');
    expect(skipReason(['A', 'B'])).toContain('A, B');
  });

  it('limitEmailsValid: exige exactamente el nº de correos requerido', () => {
    const env = readEnv({ SUPABASE_E2E_LIMIT_EMAILS: 'a,b,c,d', SUPABASE_E2E_LIMIT_PASSWORD: 'p' });
    expect(limitEmailsValid(env, 4).ok).toBe(true);
    expect(limitEmailsValid(env, 3).ok).toBe(false);
    const env2 = readEnv({ SUPABASE_E2E_LIMIT_EMAILS: 'a,b', SUPABASE_E2E_LIMIT_PASSWORD: 'p' });
    const r = limitEmailsValid(env2, 4);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('exactamente 4');
  });
});
