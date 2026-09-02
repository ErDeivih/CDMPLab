# CDMPLab — Fase 5: Correos y despliegue gratuito

> **Nota de vigencia (2026-09):** este documento es **histórico** de una fase
> anterior y describe **Cloudflare Pages** como opción de despliegue. La opción
> **vigente** de despliegue del frontend es **GitHub Pages** (ver `README.md` y
> `.github/workflows/pages.yml`, que publica bajo `/CDMPLab/`). Lo que aquí se
> mantiene vigente es la parte de **SMTP de Supabase** y la regla de **nunca
> guardar credenciales en el repo**; la elección de host (Cloudflare vs. GitHub
> Pages) queda superada por GitHub Pages. Las referencias a `EntrenoLab` son del
> nombre previo; la marca actual es **CDMPLab**.

> Objetivo: dejar la app lista para usar el SMTP configurado desde Supabase, sin
> guardar credenciales SMTP en el repositorio, y documentar el despliegue inicial
> gratuito (frontend GitHub Pages + Supabase Free + Brevo SMTP).

## Regla de seguridad
- **Nunca** guardar credenciales SMTP (host, puerto, usuario, contraseña) en el
  repositorio ni en el frontend. Se configuran solo en el panel de Supabase
  (Authentication → Emails → SMTP Settings).
- En Angular solo van `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (publicables).

## Modo de desarrollo
- Usa el **SMTP compartido de Supabase**.
- Solo para pruebas limitadas: **2 correos/hora**.
- **No afirmar que sirve para usuarios externos reales.** Documentarlo como tal en
  la ayuda/configuración de desarrollo.
- Adecuado para probar confirmación/recuperación/invitaciones con el propio equipo.

## Inicio gratuito recomendado
| Pieza | Proveedor | Notas |
|---|---|---|
| Frontend | **Cloudflare Pages** | SPA fallback para rutas Angular; variables públicas `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. |
| DB + Auth | **Supabase Free** | 500 MB DB, 50k MAU/mes, 5 GB transferencia. Puede pausar tras 1 semana sin actividad. |
| Correo (SMTP) | **Brevo Free** (o Resend Free) | Brevo ~300 correos/día; Resend ~3.000/mes y 100/día. Se conecta como SMTP de Supabase. |

> El proyecto Supabase puede pausarse tras una semana sin actividad y **no incluye
> copias descargables** de la base. Hay que conservar el respaldo JSON de EntrenoLab
> (exportación desde Ajustes).

## Pasos que debe hacer David (no se ejecutan aquí; sin sus credenciales)

### 1. Supabase → Authentication → Emails → SMTP Settings
Copiar estos campos de Brevo (Settings → SMTP & API) al panel de Supabase:

| Campo SMTP | Valor de Brevo |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS) o `465` (SSL) |
| Username | el login SMTP de Brevo (usuario del panel, no API key Salvo indicación) |
| Password | la clave SMTP de Brevo |
| Sender name | `CDMPLab` |
| Sender email | un remitente verificado en Brevo |

> No compartir la contraseña SMTP en el repositorio. Se introduce solo en Supabase.

### 2. Supabase → Authentication → URL Configuration
- **Site URL** (producción): la URL de Cloudflare Pages (p. ej. `https://entrenolab.pages.dev`).
- **Redirect URLs**: añadir la de producción y la de localhost (`http://localhost:4200/**`).
- Para SPA: el mismo Site URL sirve para confirmación, recuperación e invitación.

### 3. Cloudflare Pages — build y variables
- Framework/repo: Angular (`npm run build` → `dist/entrenolab`).
- **SPA fallback**: servir `index.html` para las rutas Angular (configurar el
  `_redirects` a `/* /index.html 200` o el equivalente en Pages).
- **Variables públicas** (en el hosting, no en el repo):
  - `SUPABASE_URL` = `https://<ref>.supabase.co`
  - `SUPABASE_PUBLISHABLE_KEY` = la clave **publishable/anon** (nunca service_role).

### 4. Regla de verificación del correo
Supabase Auth gestiona confirmación/recuperación/invitación. Con SMTP de Supabase
compartido en proyectos gratuitos **no se pueden personalizar las plantillas**; con
SMTP propio (Brevo) sí.

### 5. Opcional: CAPTCHA
Recomendado (no obligatorio) para registro y recuperación. Configurarlo en
Supabase → Authentication → Bot and Abuse Protection (requiere clave de proveedor).
No bloquear el flujo si no se configura.

## Checklist de producción ("no verificado contra la base")
- [ ] SITE_URL de producción y Redirect URLs configuradas en Supabase.
- [ ] Variables públicas `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` en Cloudflare Pages.
- [ ] SPA fallback para rutas Angular en Cloudflare Pages.
- [ ] SMTP propio (Brevo Free) configurado en Supabase Authentication (solo si David lo autoriza).
- [ ] Ninguna Secret Key (service_role) en frontend/repo/logs/capturas.
- [ ] CAPTCHA opcional decidido/configurado.
- [ ] Respaldo JSON de EntrenoLab conservado (la base Free puede pausarse y no tiene copias descargables).
