import { Session, SessionTask } from './models';
import { PALETA_JUGADOR } from './player-colors';

export const SESSION_SECTIONS = [
  { id: 'warmup', label: 'Calentamiento' },
  { id: 'main', label: 'Parte principal' },
  { id: 'cooldown', label: 'Vuelta a la calma' },
] as const;

export const EMPTY_SESSION_SHEET = {
  time: '',
  macrocycle: '',
  mesocycle: '',
  microcycle: '',
  preSession: '',
};

/** Descanso entre repeticiones y series, nunca después de la última. */
export function taskMinutes(task: SessionTask): number | null {
  if (task.minutesPerSeries == null) return task.durationMinutes;
  const count = (task.seriesCount ?? 1) * (task.repetitions ?? 1);
  return count * task.minutesPerSeries + Math.max(0, count - 1) * (task.restMinutes ?? 0);
}

export function sessionTaskGroups(
  task: SessionTask,
  session: Session,
): Array<{ name: string; color: string; players: string[] }> {
  const palette = [...PALETA_JUGADOR];
  for (const color of new Set(Object.values(task.playerColors ?? {}))) {
    if (/^#[0-9a-f]{6}$/i.test(color) && !palette.some((c) => c.color === color))
      palette.push({ nombre: `Personalizado ${color}`, color });
  }
  return palette
    .map((c) => ({
      name: c.nombre,
      color: c.color,
      players: (session.attendance ?? [])
        .filter((p) => task.playerColors?.[p.playerId] === c.color)
        .map((p) => p.playerName),
    }))
    .filter((g) => g.players.length > 0);
}

export function validSessionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
