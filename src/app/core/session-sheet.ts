import { Exercise, Session } from './models';
import { generateThumbnail } from './canvas-export';
import { EMPTY_SESSION_SHEET, SESSION_SECTIONS, sessionTaskGroups } from './session-plan';

export function escapeSheet(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
const text = (v: unknown) => escapeSheet(v).replace(/\n/g, '<br>');
const imageData = (v: string | null | undefined) =>
  v && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;

/** Documento autocontenido: sin JS de usuario, URLs remotas, ni solicitudes de datos personales. */
export function sessionSheetHtml(
  session: Session,
  teamName: string,
  images: Record<string, string | null> = {},
): string {
  const sheet = { ...EMPTY_SESSION_SHEET, ...session.sheet };
  const main = session.tasks.filter((t) => (t.section ?? 'main') === 'main');
  const attendance = session.attendance ?? [];
  const present = attendance.filter((p) => ['Asiste', 'Tarde'].includes(p.status));
  const name = session.title || `Sesión ${session.number ?? ''}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(session.date)
    ? session.date.split('-').reverse().join('/')
    : session.date;
  const total = session.tasks.reduce((s, t) => s + (t.durationMinutes ?? 0), 0);
  const rows = attendance
    .map(
      (p, i) =>
        `<tr><td>${i + 1}</td><th scope="row">${text(p.playerName)}</th><td>${text(p.status)}</td><td>${text(p.group)}</td>${Array.from(
          { length: 5 },
          (_, n) => {
            const color = main[n]?.playerColors?.[p.playerId];
            return `<td>${color && /^#[0-9a-f]{6}$/i.test(color) ? `<span class="bib" style="background:${color}"></span>` : '-'}</td>`;
          },
        ).join(
          '',
        )}<td>${p.minutes ?? '-'}</td><td>${text(p.attitude)}</td><td>${text(p.notes)}</td></tr>`,
    )
    .join('');
  const sections = SESSION_SECTIONS.map((section) => {
    const tasks = session.tasks.filter((t) => (t.section ?? 'main') === section.id);
    return `<section class="block"><h2>${section.label}</h2>${
      tasks.length
        ? tasks
            .map((t, i) => {
              const ex = t.snapshot;
              const img = imageData(images[t.id]);
              const groups = sessionTaskGroups(t, session);
              return `<article class="exercise"><h3>${i + 1}. ${text(t.title)}</h3><div class="task-meta"><span>Series: ${t.seriesCount ?? 1}</span><span>Repeticiones: ${t.repetitions ?? 1}</span><span>Trabajo: ${t.minutesPerSeries ?? t.durationMinutes ?? '-'} min</span><span>Descanso: ${t.restMinutes ?? 0} min</span><strong>Total: ${t.durationMinutes ?? 0} min</strong></div><div class="task-content"><div><h4>Desarrollo</h4><p>${text(t.development ?? ex?.explanation ?? '') || 'Sin indicaciones.'}</p>${(t.aspects ?? ex?.description) ? `<h4>Aspectos a incidir</h4><p>${text(t.aspects ?? ex?.description)}</p>` : ''}${t.progression ? `<h4>Progresión</h4><p>${text(t.progression)}</p>` : ''}${t.dimensions ? `<p><b>Dimensiones:</b> ${text(t.dimensions)}</p>` : ''}${t.material || ex?.materials?.length ? `<p><b>Material:</b> ${text(t.material || ex?.materials?.join(', '))}</p>` : ''}${groups.length ? `<div class="groups">${groups.map((g) => `<p><span class="bib" style="background:${g.color}"></span><b>${g.name}:</b> ${text(g.players.join(', '))}</p>`).join('')}</div>` : ''}</div><div>${img ? `<img class="diagram" src="${img}" alt="Diagrama de ${escapeSheet(t.title)}">` : '<div class="no-image">Sin dibujo</div>'}</div></div></article>`;
            })
            .join('')
        : '<p class="empty">Sin ejercicios programados.</p>'
    }</section>`;
  }).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ficha - ${escapeSheet(name)}</title><style>
  @page{@bottom-center{content:"CDMPLab - " counter(page) " / " counter(pages);font:8px Arial;color:#666}}
  @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#181818;margin:0;background:#fff}main{max-width:186mm;margin:20px auto}h1{font-size:19px;margin:0 0 5px}h2{font-size:12px;text-transform:uppercase;background:#dedede;border:1px solid #999;padding:7px;margin:15px 0 0;break-after:avoid}h3{font-size:12px;background:#f1f1f1;border-bottom:1px solid #aaa;padding:7px;margin:0;break-after:avoid}h4{font-size:10px;margin:8px 0 3px}p{margin:4px 0;line-height:1.45;overflow-wrap:anywhere}.heading{border:1px solid #999;padding:12px;display:flex;justify-content:space-between;gap:15px;break-inside:avoid}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border:1px solid #aaa;padding:8px;margin-bottom:10px}.summary{display:grid;grid-template-columns:1fr 2fr;gap:12px;padding:10px;border:1px solid #aaa;break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:9px}thead{display:table-header-group}th,td{border:1px solid #aaa;padding:5px;text-align:left;overflow-wrap:anywhere}thead th{background:#ddd}tbody th{font-weight:normal}tr{break-inside:avoid}.bib{display:inline-block;width:9px;height:9px;border:1px solid #777;vertical-align:middle;margin-right:3px}.legend{font-size:9px;margin:5px 0}.exercise{border:1px solid #aaa;border-top:0;break-inside:avoid}.task-meta{display:flex;flex-wrap:wrap;gap:12px;padding:6px;border-bottom:1px solid #aaa;font-size:9px}.task-content{display:grid;grid-template-columns:3fr 2fr;gap:12px;padding:9px;min-height:105px}.diagram{display:block;max-width:100%;width:100%;height:42mm;object-fit:contain}.no-image{color:#888;display:grid;place-items:center;height:30mm;border:1px dashed #ccc}.groups p{font-size:9px}.empty{padding:10px;border:1px solid #aaa}.totals{border:1px solid #aaa;background:#eee;padding:10px;font-weight:bold;break-inside:avoid}.toolbar{display:flex;gap:12px;padding:12px;background:#eee;align-items:center}.toolbar button{padding:10px;cursor:pointer}footer{margin-top:10px;font-size:9px;color:#555}@media print{main{margin:0;max-width:none}.toolbar{display:none}}@media screen and (max-width:600px){main{padding:10px}.task-content,.summary{grid-template-columns:1fr}.attendance{overflow:auto}table{min-width:600px}}
  </style></head><body><div class="toolbar"><button id="print-sheet" type="button">Guardar PDF / Imprimir</button><span>En el diálogo, selecciona «Guardar como PDF». La ficha incluye dibujos en los tres bloques.</span></div><main><header class="heading"><div><h1>C.D.M. Pizarrales - Entrenamiento</h1><div>${text(name)}</div></div><div><b>${text(teamName)}</b><p>Sesión ${session.number ?? '-'} · ${text(date)} ${text(sheet.time)}</p></div></header><div class="meta"><div><b>Macrociclo</b><p>${text(sheet.macrocycle) || '-'}</p></div><div><b>Mesociclo</b><p>${text(sheet.mesocycle) || '-'}</p></div><div><b>Microciclo</b><p>${text(sheet.microcycle) || '-'}</p></div></div><div class="summary"><div><b>Material</b><p>${text(session.material)}</p></div><div><b>Objetivos / contenido</b><p>${text(session.objectives)}</p>${session.notes ? `<b>Notas</b><p>${text(session.notes)}</p>` : ''}</div></div><h2>Jugadores / asistencia</h2><div class="attendance"><table><thead><tr><th>Nº</th><th>Jugador</th><th>Asistencia</th><th>Grupo</th>${[1, 2, 3, 4, 5].map((n) => `<th>Ej. ${n}</th>`).join('')}<th>Min</th><th>Actitud</th><th>Observaciones</th></tr></thead><tbody>${rows || '<tr><td colspan="12">Sin jugadores registrados.</td></tr>'}</tbody></table></div><p class="legend">Petos: columnas 1-5 de la parte principal. La distribución completa de cada ejercicio aparece debajo de su desarrollo.</p><p><b>Presentes:</b> ${present.length} · <b>Porteros:</b> ${present.filter((p) => p.position === 'GK').length} · <b>Jugadores registrados:</b> ${attendance.length}</p>${sheet.preSession ? `<h2>Pre-sesión</h2><p>${text(sheet.preSession)}</p>` : ''}${sections}<p class="totals">Tiempo previsto: ${session.durationMinutes ?? total} min · Tiempo programado: ${total} min</p><footer>CDMPLab · Ficha generada con los datos guardados de la sesión.</footer></main></body></html>`;
}

export async function prepareSessionSheet(
  session: Session,
  teamName: string,
  exercises: Exercise[],
): Promise<string> {
  const resolved: Session = {
    ...session,
    tasks: session.tasks.map((task) => ({
      ...task,
      snapshot:
        task.snapshot ??
        exercises.find((e) => e.id === task.exerciseId && e.teamId === session.teamId),
    })),
  };
  const images: Record<string, string | null> = {};
  for (const task of session.tasks) {
    const ex = task.snapshot ?? exercises.find((e) => e.id === task.exerciseId);
    const canvas = ex?.canvas
      ? {
          ...ex.canvas,
          playerColors: { ...ex.canvas.playerColors, ...task.playerColors },
          frames: ex.canvas.frames.map((frame) => ({
            ...frame,
            elements: frame.elements.map((el) =>
              el.t === 'player' && el.playerId && task.playerColors?.[el.playerId]
                ? { ...el, c: task.playerColors[el.playerId] }
                : el,
            ),
          })),
        }
      : null;
    if (canvas && canvas.frames.some((frame) => frame.elements.length)) {
      images[task.id] = await generateThumbnail(canvas);
      if (!images[task.id])
        throw new Error(`No se pudo dibujar «${task.title}». Reintenta con conexión.`);
    } else images[task.id] = imageData(ex?.thumbnail);
  }
  return sessionSheetHtml(resolved, teamName, images);
}

export async function fillSessionSheetWindow(
  windowRef: Window,
  session: Session,
  teamName: string,
  exercises: Exercise[],
): Promise<void> {
  const html = await prepareSessionSheet(session, teamName, exercises);
  if (windowRef.closed) throw new Error('Se cerró la vista de impresión.');
  windowRef.document.open();
  windowRef.document.write(html);
  windowRef.document.close();
  await Promise.all(Array.from(windowRef.document.images).map((img) => img.decode()));
  windowRef.document
    .getElementById('print-sheet')
    ?.addEventListener('click', () => windowRef.print());
}
