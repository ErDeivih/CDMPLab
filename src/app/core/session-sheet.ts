import { Exercise, Session } from './models';
import { generateThumbnail } from './canvas-export';
import {
  EMPTY_SESSION_SHEET,
  SESSION_SECTIONS,
  sessionTaskGroups,
  validSessionDate,
} from './session-plan';

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
  crest?: string,
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
        `<tr><td>${i + 1}</td><th scope="row">${text(p.playerName)}</th><td title="${escapeSheet(p.status)}">${text(attendanceCode(p.status))}</td><td>${text(p.group)}</td><td>${bibFor(session.tasks.find((t) => t.section === 'warmup')?.playerColors?.[p.playerId])}</td>${Array.from(
          { length: 5 },
          (_, n) => {
            const color = main[n]?.playerColors?.[p.playerId];
            return `<td>${bibFor(color)}</td>`;
          },
        ).join(
          '',
        )}<td>${bibFor(session.tasks.find((t) => t.section === 'cooldown')?.playerColors?.[p.playerId])}</td><td>${p.minutes ?? '-'}</td><td>${text(p.attitude)}</td><td>${text(p.notes)}</td></tr>`,
    )
    .join('');
  const sections = SESSION_SECTIONS.map((section) => {
    const tasks = session.tasks.filter((t) => (t.section ?? 'main') === section.id);
    return `<section class="block block-${section.id}"><h2>${section.label}<span>${tasks.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0)} min</span></h2>${
      tasks.length
        ? tasks
            .map((t, i) => {
              const ex = t.snapshot;
              const img = imageData(images[t.id]);
              const groups = sessionTaskGroups(t, session);
              return `<article class="exercise"><div class="exercise-header"><div><div class="exercise-label">EJERCICIO ${i + 1}</div><h3>${i + 1}. ${text(t.title)}</h3></div><table class="task-meta"><thead><tr><th>DIMENSIONES</th><th>JUG. CON PETO</th><th>SERIES / REP / MIN</th><th>DESC.</th><th>TIEMPO</th></tr></thead><tbody><tr><td>${text(t.dimensions) || '-'}</td><td>${Object.keys(t.playerColors ?? {}).length || '-'}</td><td>${t.seriesCount ?? 1} / ${t.repetitions ?? 1} / ${t.minutesPerSeries ?? t.durationMinutes ?? '-'}′</td><td>${t.restMinutes ?? 0}′</td><td><b>${t.durationMinutes ?? 0}′</b></td></tr></tbody></table></div><div class="task-content"><div class="instructions"><p>${text(t.development ?? ex?.explanation ?? '')}</p>${(t.aspects ?? ex?.description) ? `<h4>Aspectos a incidir:</h4><p>${text(t.aspects ?? ex?.description)}</p>` : ''}${t.progression ? `<h4>Progresión:</h4><p>${text(t.progression)}</p>` : ''}${t.material || ex?.materials?.length ? `<p class="task-material"><b>Material:</b> ${text(t.material || ex?.materials?.join(', '))}</p>` : ''}${groups.length ? `<div class="groups">${groups.map((g) => `<p>${bibFor(g.color)}<b>${g.name}:</b> ${text(g.players.join(', '))}</p>`).join('')}</div>` : ''}</div><div class="drawing">${img ? `<img class="diagram" src="${img}" alt="Diagrama de ${escapeSheet(t.title)}">` : '<div class="no-image">Sin dibujo</div>'}</div></div></article>`;
            })
            .join('')
        : '<p class="empty">Sin ejercicios programados.</p>'
    }</section>`;
  }).join('');
  const emptyRows = Array.from(
    { length: Math.max(0, 21 - attendance.length) },
    (_, i) =>
      `<tr class="blank-player"><td>${attendance.length + i + 1}</td><th scope="row"></th>${'<td></td>'.repeat(12)}</tr>`,
  ).join('');
  const logo = imageData(crest);
  const dateInfo = sheetDateInfo(session.date);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ficha - ${escapeSheet(name)}</title><style>
  @page{size:A4;margin:5mm;@bottom-center{content:"CDMPLab - " counter(page) " / " counter(pages);font:7px Arial;color:#666}}
  *{box-sizing:border-box}body{font:10px Arial,sans-serif;color:#161616;margin:0;background:white;print-color-adjust:exact;-webkit-print-color-adjust:exact}main{width:200mm;max-width:100%;margin:16px auto}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #999;padding:3px;overflow-wrap:anywhere}th{background:#d9d9d9;color:#444;font-size:9px;text-align:center}td{vertical-align:top}p{margin:2px 0;line-height:1.23;overflow-wrap:anywhere}h1{font-size:14px;margin:0;text-align:center}h2{font-size:10px;text-transform:uppercase;text-align:center;color:#444;background:#d9d9d9;border:1px solid #999;padding:5px;margin:0;break-after:avoid;position:relative}h2 span{position:absolute;right:6px;font-weight:normal}h3{font-size:11px;font-weight:normal;margin:0;padding:4px}h4{font-size:9px;background:#ddd;border:1px solid #999;display:table;min-width:28mm;margin:5px 0 2px;padding:1px 3px}tr{break-inside:avoid}.heading{break-inside:avoid}.heading .crest{width:25mm;padding:3mm;vertical-align:middle;text-align:center}.crest img{width:19mm;height:22mm;object-fit:contain}.number{font-size:28px;font-weight:bold;text-align:center;vertical-align:middle}.heading td:not(.crest):not(.number){text-align:center;vertical-align:middle}.organization-label{background:#d9d9d9;font-weight:bold;color:#444}.summary{margin-top:-1px;margin-bottom:3mm}.summary th:first-child{width:25%}.summary td{min-height:22mm;height:24mm}.attendance{margin-top:3mm}.attendance table{font-size:8px}.attendance th,.attendance td{padding:1px 2px;height:3.6mm;vertical-align:middle}.attendance tbody th{background:white;text-align:left;font-size:8px;font-weight:normal;color:#161616}.attendance td{text-align:center}.attendance td:last-child{text-align:left}.bib{display:inline-block;width:7px;height:7px;border:1px solid #777;vertical-align:middle}.groups .bib{margin-right:3px}.attendance-total{border:1px solid #999;margin-top:-1px;display:flex;gap:10px;align-items:center;padding:3px;font-size:8px;background:#eee}.legend{font-size:7px;margin:3px 0 4mm}.pre-session{border:1px solid #999;margin-bottom:3mm;break-inside:avoid}.pre-session h2{border:0;border-bottom:1px solid #999}.pre-session p{min-height:24mm;padding:4px}.block-main{break-before:page}.block{margin-top:3mm}.exercise{border:1px solid #999;border-top:0;break-inside:avoid}.exercise-header{display:grid;grid-template-columns:60% 40%;border-bottom:1px solid #999;break-inside:avoid;break-after:avoid}.exercise-label{background:#d9d9d9;color:#444;font:7px Arial;padding:2px 4px;border-bottom:1px solid #999}.task-meta{font-size:8px;margin:0;border-top:0}.task-meta th{font-size:6px;padding:2px 1px}.task-meta td{text-align:center;padding:4px 1px;vertical-align:middle}.task-content{display:grid;grid-template-columns:60% 40%;min-height:30mm}.instructions{padding:4px;border-right:1px solid #999}.drawing{padding:2mm;display:flex;align-items:center;justify-content:center}.diagram{display:block;width:100%;max-width:100%;height:28mm;object-fit:contain}.no-image{font-size:8px;color:#888}.groups{margin-top:4px}.groups p,.task-material{font-size:8px}.empty{padding:8px;border:1px solid #999;border-top:0;margin:0}.totals{margin:0;border:1px solid #999;border-top:0;background:#d9d9d9;padding:5px;font-size:9px;text-align:right;break-inside:avoid}footer{margin-top:3px;font-size:7px;color:#555}.toolbar{display:flex;gap:12px;padding:12px;background:#eee;align-items:center;font-size:12px}.toolbar button{padding:10px;cursor:pointer}@media print{main{margin:0;width:auto;max-width:none}.toolbar{display:none}}@media screen and (max-width:600px){main{min-width:700px;margin:10px}.toolbar{position:sticky;left:0;width:100vw}}
  </style></head><body><div class="toolbar"><button id="print-sheet" type="button">Guardar PDF / Imprimir</button><span>Selecciona «Guardar como PDF». Formato A4, escala 100 %, sin cabeceras del navegador. Dibujos en los tres bloques.</span></div><main><header class="heading"><table><colgroup><col style="width:12.5%"><col style="width:10%"><col style="width:25%"><col style="width:27.5%"><col style="width:25%"></colgroup><tbody><tr><td class="crest" rowspan="4">${logo ? `<img src="${logo}" alt="Escudo C.D.M. Pizarrales">` : '<b>C.D.M.<br>PIZARRALES</b>'}</td><th colspan="3"><h1>C.D.M. PIZARRALES${dateInfo.season ? ` - TEMPORADA ${dateInfo.season}` : ' - ENTRENAMIENTO'}</h1></th><th>EQUIPO</th></tr><tr><th>SESIÓN</th><td>SEMANA: ${text(dateInfo.week)}</td><td>FECHA: ${text(dateInfo.weekday)} ${text(date)} ${text(sheet.time)}</td><td>${text(teamName)}</td></tr><tr><td class="number" rowspan="2">${session.number ?? '-'}</td><th>MACROCICLO</th><th>MESOCICLO</th><th>MICROCICLO</th></tr><tr><td>${text(sheet.macrocycle) || '-'}</td><td>${text(sheet.mesocycle) || '-'}</td><td>${text(sheet.microcycle) || '-'}</td></tr></tbody></table></header><table class="summary"><thead><tr><th>MATERIAL</th><th>OBJETIVOS / CONTENIDO</th></tr></thead><tbody><tr><td>${text(session.material)}</td><td>${session.title ? `<p><b>${text(session.title)}</b></p>` : ''}${text(session.objectives)}${session.notes ? `<p><b>Notas:</b> ${text(session.notes)}</p>` : ''}</td></tr></tbody></table><div class="attendance"><table aria-label="Jugadores / asistencia"><colgroup><col style="width:4%"><col style="width:18%"><col style="width:5%"><col style="width:7%">${'<col style="width:3%">'.repeat(7)}<col style="width:7%"><col style="width:9%"><col style="width:29%"></colgroup><thead><tr><th>Nº</th><th>JUGADOR</th><th>ASIS</th><th>GRUPO</th><th>C</th>${[1, 2, 3, 4, 5].map((n) => `<th>Ej. ${n}</th>`).join('')}<th>VC</th><th>MIN</th><th>ACTITUD</th><th>OBSERVACIONES</th></tr></thead><tbody>${rows}${emptyRows}</tbody></table></div><div class="attendance-total"><span><b>Presentes:</b> ${present.length}</span><span><b>Campo:</b> ${present.filter((p) => p.position !== 'GK').length}</span><span><b>Porteros:</b> ${present.filter((p) => p.position === 'GK').length}</span><span><b>Registrados:</b> ${attendance.length}</span></div><p class="legend">A: asiste · T: tarde · R: recupera · L: lesión · E: enfermo · ES: estudios · V: viaje/vacaciones · TR: trabajo · SI: sanción interna · CP: castigo padres · F: falta no justificada · O: otros.<br>Petos C / 1-5 / VC: primer ejercicio de calentamiento, cinco ejercicios principales y primera vuelta a la calma. Todos los grupos aparecen en cada ficha.</p><section class="pre-session"><h2>PRE-SESIÓN</h2><p>${text(sheet.preSession)}</p></section>${sections}<p class="totals">TIEMPO PREVISTO: ${session.durationMinutes ?? total}′ &nbsp; | &nbsp; TOTAL PROGRAMADO: ${total}′</p><footer>CDMPLab · Datos guardados de la sesión. Carga calculada no disponible: no se estima una fórmula ajena.</footer></main></body></html>`;
}

function sheetDateInfo(value: string): { season: string; week: string; weekday: string } {
  const date = new Date(`${value}T12:00:00Z`);
  if (!validSessionDate(value)) return { season: '', week: '-', weekday: '' };
  const year = date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return {
    season: `${year}/${String(year + 1).slice(-2)}`,
    week: `${format.format(start)} - ${format.format(end)}`,
    weekday: new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' }).format(date),
  };
}

function attendanceCode(status: string): string {
  const codes: Record<string, string> = {
    Asiste: 'A',
    Tarde: 'T',
    Recupera: 'R',
    Lesión: 'L',
    Enfermo: 'E',
    Estudios: 'ES',
    'Viaje / Vacaciones': 'V',
    Trabajo: 'TR',
    'Sanción Interna': 'SI',
    'Castigo Padres': 'CP',
    'Falta No Justificada': 'F',
    Otros: 'O',
  };
  return codes[status] ?? status;
}

function bibFor(color?: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color)
    ? `<span class="bib" style="background:${color}"></span>`
    : '-';
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
  for (const task of resolved.tasks) {
    const ex = task.snapshot;
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
  const response = await fetch('favicon-192x192.png');
  if (!response.ok)
    throw new Error('No se pudo cargar el escudo de la ficha. Reintenta con conexión.');
  const crest = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo preparar el escudo de la ficha.'));
    void response.blob().then((blob) => reader.readAsDataURL(blob), reject);
  });
  return sessionSheetHtml(resolved, teamName, images, crest);
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
