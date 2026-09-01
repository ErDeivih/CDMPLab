// =============================================================
// EntrenoLab — Punto de entrada del borrador IA (previsualización).
//
// Convierte un `AiExerciseDraftV1` serializado (JSON) en un
// `CanvasDocument` editable + sus metadatos. La app usa esto para abrir
// el borrador en la pizarra como PREVISUALIZACIÓN: el entrenador lo
// edita, lo descarta o lo guarda bajo su confirmación. Nunca se
// auto-guarda.
//
// La IA no se conecta aquí: el draft ya es un objeto validado.
// =============================================================
import { AiExerciseDraftV1 } from './ai-draft';
import { validateAiDraft } from './ai-validator';
import { compileAiDraft, DraftMeta } from './ai-compiler';
import { CanvasDocument } from '../models';

export type AiDraftLoadResult =
  | { ok: true; doc: CanvasDocument; meta: DraftMeta }
  | { ok: false; error: string };

/** Decodifica un borrador IA serializado y lo compila a un documento editable. */
export function loadAiDraft(raw: string): AiDraftLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'El borrador IA no es JSON válido' };
  }
  const validation = validateAiDraft(parsed);
  if (!validation.ok) return { ok: false, error: validation.error };
  const compiled = compileAiDraft(parsed as AiExerciseDraftV1);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return { ok: true, doc: compiled.doc, meta: compiled.meta };
}
