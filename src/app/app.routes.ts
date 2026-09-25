import { Routes } from '@angular/router';
import { PendingChangesGuard } from './features/board/pending-changes.guard';
import { AiDraftGuard } from './features/board/ai-draft.guard';
import { ExerciseBoardGuard } from './features/board/exercise-board.guard';
import { AuthGuard, ApprovedGuard, AdminGuard } from './core/auth.guard';

/**
 * Rutas de EntrenoLab.
 *
 *  · /auth/*        → públicas (no exigen sesión).
 *  · /access-*      → sesión iniciada, pero perfil rechazado/suspendido.
 *  · /invitations   → sesión + aprobada, con invitaciones pendientes.
 *  · /onboarding/*  → sesión + aprobada, sin equipo (crear o aceptar).
 *  · /admin         → sesión + ADMIN DE PLATAFORMA (RPC real).
 *  · /team,/board,/library,/sessions → sesión + aprobada + con equipo.
 *
 * Todos los componentes de ruta se cargan de forma LAZY (`loadComponent`) para
 * mantenerlos fuera del bundle inicial. Los guards permanecen eager: son
 * pequeños y no arrastran dependencias pesadas.
 */
export const routes: Routes = [
  {
    path: 'auth/login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/register',
    loadComponent: () =>
      import('./features/auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'auth/verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'auth/forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'auth/update-password',
    loadComponent: () =>
      import('./features/auth/update-password.component').then((m) => m.UpdatePasswordComponent),
  },
  {
    path: '',
    canActivate: [AuthGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'team' },
      {
        path: 'pending-approval',
        loadComponent: () =>
          import('./features/auth/pending-approval.component').then(
            (m) => m.PendingApprovalComponent,
          ),
      },
      {
        path: 'access-rejected',
        loadComponent: () =>
          import('./features/auth/access-rejected.component').then(
            (m) => m.AccessRejectedComponent,
          ),
      },
      {
        path: 'access-suspended',
        loadComponent: () =>
          import('./features/auth/access-suspended.component').then(
            (m) => m.AccessSuspendedComponent,
          ),
      },
      {
        path: 'invitations',
        loadComponent: () =>
          import('./features/auth/invitations.component').then((m) => m.InvitationsComponent),
      },
      {
        path: 'onboarding/migrate',
        loadComponent: () =>
          import('./features/auth/migration-wizard.component').then(
            (m) => m.MigrationWizardComponent,
          ),
      },
      {
        path: 'onboarding/team',
        loadComponent: () =>
          import('./features/auth/onboarding-team.component').then(
            (m) => m.OnboardingTeamComponent,
          ),
      },
      {
        path: 'settings/team/members',
        loadComponent: () =>
          import('./features/auth/members.component').then((m) => m.MembersComponent),
        canActivate: [ApprovedGuard],
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/auth/admin-access.component').then((m) => m.AdminAccessComponent),
        canActivate: [AdminGuard],
      },
      { path: 'admin/access', redirectTo: 'admin' },
      {
        path: 'team',
        loadComponent: () =>
          import('./features/roster/roster.component').then((m) => m.RosterComponent),
        canActivate: [ApprovedGuard],
      },
      {
        path: 'board/draft',
        loadComponent: () =>
          import('./features/board/board.component').then((m) => m.BoardComponent),
        canActivate: [ApprovedGuard, AiDraftGuard],
        canDeactivate: [PendingChangesGuard],
      },
      {
        path: 'board',
        loadComponent: () =>
          import('./features/board/board.component').then((m) => m.BoardComponent),
        canActivate: [ApprovedGuard, ExerciseBoardGuard],
        canDeactivate: [PendingChangesGuard],
      },
      {
        path: 'library',
        loadComponent: () =>
          import('./features/library/library.component').then((m) => m.LibraryComponent),
        canActivate: [ApprovedGuard],
      },
      {
        path: 'sessions',
        loadComponent: () =>
          import('./features/sessions/sessions.component').then((m) => m.SessionsComponent),
        canActivate: [ApprovedGuard],
      },
    ],
  },
  { path: '**', redirectTo: 'team' },
];
