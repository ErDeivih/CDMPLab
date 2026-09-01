# EntrenoLab — Modelo de datos (Supabase nuevo)

> Backend nuevo y aislado. Los equipos tienen su plantilla de jugadores a mano para
> colocarlos en el campo al instante. Tenemos sesiones y ejercicios, con biblioteca
> organizada y autoguardado para retomar donde se dejó.

## Esquema

### `profiles`
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | = auth.users.id |
| `display_name` | text | |
| `avatar_url` | text | opcional |
| `team_id` | uuid FK→teams | equipo "activo" por defecto |

### `teams`
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | nombre del equipo |
| `accent_color` | text | color de marca del equipo (#hex) |
| `created_by` | uuid FK→auth.users | |
| `created_at`/`updated_at` | timestamptz | |

### `players` (la plantilla por equipo)
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK→teams | |
| `name` | text | |
| `number` | smallint | dorsal (null si no tiene) |
| `position` | text | GK / DF / MF / FW (o libre) |
| `color` | text | color de la ficha (#hex) |
| `active` | bool | para no borrar histórico |
| `created_at`/`updated_at` | timestamptz | |

Índice: `(team_id, active)`, `(team_id, name)`.

### `exercise_folders`
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK→teams | |
| `parent_id` | uuid FK→exercise_folders | null si es raíz |
| `name` | text | |

Índice: `(team_id, parent_id)`.

### `exercises`
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK→teams | |
| `folder_id` | uuid FK→exercise_folders | null si sin carpeta |
| `title` | text | |
| `description` | text | |
| `explanation` | text | instrucciones para el jugador |
| `category` | text | Técnica / Táctica / Físico / Portero / Calentamiento / Partido |
| `objectives` | text[] | |
| `materials` | text[] | |
| `duration_minutes` | smallint | 1–240 |
| `min_players`/`max_players` | smallint | 0 vacío |
| `load_mode` | text | `fixed` \| `interval` |
| `series_count` / `repetitions_count` / `work_seconds` / `rest_seconds` | smallint | modo interval |
| `is_template` | bool | |
| `canvas_data` | jsonb | **v2 con frames**: `{"version":2,"field":...,"frames":[{"duration":ms,"elements":[...]}]}` |
| `thumbnail` | text | PNG base64 (o data-url) |
| `created_at`/`updated_at` | timestamptz | |

Índices: `(team_id, folder_id)`, búsqueda full-text sobre
`title/description/explanation`, `(team_id, updated_at desc)`.
`updated_at` se actualiza con trigger en cada UPDATE.

### `sessions`
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK→teams | |
| `title` | text | |
| `date` | date | |
| `start_time` | time | opcional |
| `duration_minutes` | smallint | |
| `notes` | text | |
| `objectives` / `materials` | text[] | |
| `created_at`/`updated_at` | timestamptz | |

### `session_exercises`
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK→sessions | |
| `exercise_id` | uuid FK→exercises | |
| `sort_order` | smallint | |
| `duration_minutes` | smallint | override opcional |

## Autoguardado / retomar (sin tocar la BD)

El borrador de un ejercicio ("rehacer donde lo dejé") se guarda en **localStorage /
IndexedDB**, con clave `entrenolab:draft:teamId:<new>|<exerciseId>`. Se restaura si
`savedAt > updatedAt` remoto. Al guardar con éxito, se limpia. Aislamiento por equipo.

## Seguridad / RLS

- Escritura (INSERT/UPDATE/DELETE) en `teams`, `players`, `exercises`,
  `exercise_folders`, `sessions`, `session_exercises`: solo miembros staff del equipo.
- Lectura: todos los miembros del equipo.
- Roles por equipo: `coordinator | admin | coach | player`. La UI oculta; la barrera real
  es RLS en el servidor.

## Formato `canvas_data` (elementos)

Coordenadas normalizadas 0..1. Claves cortas. Cada elemento con `id` estable para
interpolar entre frames.

```
{"id":"e1","t":"player","x":0.3,"y":0.5,"n":9,"c":"#1a73e8","side":"own"}
{"id":"e2","t":"ball","x":0.45,"y":0.5}
{"id":"e3","t":"cone","x":0.5,"y":0.3,"c":"#f9ab00"}
{"id":"e4","t":"text","x":0.7,"y":0.1,"v":"Presión alta","size":14}
{"id":"e5","t":"zone","x":0.2,"y":0.2,"w":0.25,"h":0.3,"c":"#d9302533"}
{"id":"e6","t":"arrow","x1":0.3,"y1":0.5,"x2":0.5,"y2":0.35,"style":"solid","c":"#202124"}
{"id":"e7","t":"line","x1":0.1,"y1":0.2,"x2":0.4,"y2":0.2,"c":"#202124"}
{"id":"e8","t":"dribble","points":[[0.2,0.4],[0.3,0.45],[0.4,0.4]],"c":"#202124"}
```
