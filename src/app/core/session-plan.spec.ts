import { describe, it, expect } from 'vitest';
import { taskMinutes, validSessionDate, sessionTaskGroups } from './session-plan';
import { sessionSheetHtml, escapeSheet } from './session-sheet';
import { Session, SessionTask } from './models';

const task: SessionTask = {
  id: 't',
  exerciseId: null,
  title: 'Circuito',
  sortOrder: 0,
  material: '',
  durationMinutes: 16,
  seriesCount: 1,
  minutesPerSeries: 8,
};
const session: Session = {
  id: 's',
  teamId: 'team',
  title: '',
  date: '2026-10-13',
  durationMinutes: 120,
  notes: '',
  tasks: [task],
  createdAt: 'now',
  savedAt: 'now',
};

describe('sesiones: tiempos y fechas reales', () => {
  it('ficha club: escudo autocontenido, temporada y semana de la fecha de sesión', () => {
    const crest = 'data:image/png;base64,aGVsbG8=';
    const html = sessionSheetHtml(session, 'Juvenil B', {}, crest);
    expect(html).toContain('TEMPORADA 2026/27');
    expect(html).toContain('12 oct - 18 oct');
    expect(html).toContain('Escudo C.D.M. Pizarrales');
    expect(html).toContain(crest);
    expect(sessionSheetHtml(session, 'Equipo', {}, 'https://evil.test/logo.png')).not.toContain(
      'https://evil',
    );
    expect(sessionSheetHtml({ ...session, date: '2026-05-01' }, 'Equipo')).toContain(
      'TEMPORADA 2025/26',
    );
  });
  it('incluye descansos entre repeticiones, no al terminar', () => {
    expect(taskMinutes({ ...task, repetitions: 2, restMinutes: 4 })).toBe(20);
    expect(taskMinutes({ ...task, seriesCount: 2, repetitions: 2, restMinutes: 1 })).toBe(35);
    expect(taskMinutes({ ...task, restMinutes: 10 })).toBe(8);
  });
  it('conserva tareas antiguas sin configuración temporal', () => {
    expect(taskMinutes({ ...task, minutesPerSeries: null })).toBe(16);
  });
  it('rechaza fechas inexistentes y admite años bisiestos', () => {
    expect(validSessionDate('2026-02-30')).toBe(false);
    expect(validSessionDate('2026-02-29')).toBe(false);
    expect(validSessionDate('2024-02-29')).toBe(true);
    expect(validSessionDate('')).toBe(false);
    expect(validSessionDate('2026-10-13')).toBe(true);
  });
});

describe('ficha segura de sesión', () => {
  it('escapa texto y no admite imágenes remotas ni SVG con scripts', () => {
    const html = sessionSheetHtml({ ...session, title: '<script>mal()</script>' }, 'A & B', {
      t: 'https://evil.test/image.png',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).not.toContain('https://evil');
    expect(escapeSheet('"')).toBe('&quot;');
  });
  it('tres bloques comparten el mismo soporte de imágenes y se muestran cinco columnas', () => {
    const tasks: SessionTask[] = ['warmup', 'main', 'cooldown'].map((section, i) => ({
      ...task,
      id: String(i),
      section: section as SessionTask['section'],
    }));
    const png = 'data:image/png;base64,aGVsbG8=';
    const html = sessionSheetHtml({ ...session, tasks }, 'Equipo', {
      '0': png,
      '1': png,
      '2': png,
    });
    expect(html.match(/class="diagram"/g)).toHaveLength(3);
    expect(html).toContain('<th>Ej. 5</th>');
    expect(html).toContain('Vuelta a la calma');
    expect(html).toContain('TIEMPO PREVISTO: 120′');
  });
  it('los grupos no pierden nombres, ni confunden porteros lesionados con presentes', () => {
    const s: Session = {
      ...session,
      attendance: [
        {
          playerId: 'p',
          playerName: 'Ana',
          status: 'Lesión',
          group: '',
          attitude: '',
          minutes: null,
          notes: '',
          position: 'GK',
        },
      ],
    };
    expect(sessionTaskGroups({ ...task, playerColors: { p: '#8e44ad' } }, s)[0].players).toEqual([
      'Ana',
    ]);
    expect(sessionSheetHtml(s, 'Equipo')).toContain('<b>Porteros:</b> 0');
  });
});
