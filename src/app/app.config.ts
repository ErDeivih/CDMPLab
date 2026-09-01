import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { AccessService } from './core/access.service';
import { SupabaseService } from './core/supabase.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Resuelve la sesión de Supabase Y el estado de acceso ANTES del primer
    // render, de modo que el shell y los guards jamás muestren contenido
    // protegido por un instante. En modo local (desarrollo) resuelve al
    // instante a `disabled` sin romper nada; en producción la sesión es
    // obligatoria y los guards bloquean si no está.
    provideAppInitializer(() => inject(AccessService).resolve()),
  ],
};
