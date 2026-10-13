import { beforeEach, expect, it } from 'vitest';
import { SessionDesignService } from './session-design.service';
import { Session } from './models';

const session: Session = {
  id: 's',
  teamId: 't',
  title: 'Prueba',
  date: '2026-10-13',
  durationMinutes: 120,
  notes: '',
  tasks: [],
  createdAt: 'now',
  savedAt: 'now',
};
beforeEach(() => sessionStorage.clear());
it('el borrador de retorno está aislado por contexto y se consume una sola vez', () => {
  const bridge = new SessionDesignService();
  bridge.put('user-a:team-a', { session, taskId: 't', exerciseId: 'e', baseline: 'original' });
  expect(bridge.take('user-b:team-a')).toBeNull();
  expect(bridge.take('user-a:team-b')).toBeNull();
  expect(bridge.take('user-a:team-a')?.session.title).toBe('Prueba');
  expect(bridge.take('user-a:team-a')).toBeNull();
});
it('un borrador corrupto da error explícito sin borrarlo', () => {
  sessionStorage.setItem('cdmplab:session-design:v1:test', '{"session":null}');
  expect(() => new SessionDesignService().take('test')).toThrow('no es válido');
  expect(sessionStorage.getItem('cdmplab:session-design:v1:test')).not.toBeNull();
});
