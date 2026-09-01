import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

// Marca observable del entorno de build en <html> para las pruebas E2E:
//   · 'production'   → build real (Supabase, guards activos).
//   · 'development'  → build local/dev (Supabase vacío, modo local).
// Permite a `playwright.prod.config.ts` verificar de forma DETERMINISTA que se
// sirve la build de producción (con Supabase) y no la de desarrollo.
document.documentElement.setAttribute('data-entrenolab-mode', environment.production ? 'production' : 'development');

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
