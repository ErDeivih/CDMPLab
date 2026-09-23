import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AccessService } from '../../core/access.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  imports: [ReactiveFormsModule, RouterLink, AuthCardComponent],
})
export class LoginComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly submitting = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly emailInvalid = computed(
    () => this.form.controls.email.invalid && this.form.controls.email.touched,
  );
  protected readonly passwordInvalid = computed(
    () => this.form.controls.password.invalid && this.form.controls.password.touched,
  );

  /**
   * Destino al que volver tras iniciar sesión (`?returnUrl=`), si es una ruta INTERNA.
   *
   * El enlace del correo de invitación pasa por aquí cuando quien lo pulsa no tiene sesión: sin
   * esto, el destino se perdía y la invitación quedaba invisible (el usuario aterrizaba en su
   * equipo y no había ninguna entrada de navegación hacia `/invitations`). Se rechaza cualquier
   * URL absoluta o `//host`: el login no puede ser un redirector abierto.
   */
  protected readonly returnUrl = signal<string | null>(this.leerDestinoInterno());

  private leerDestinoInterno(): string | null {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    if (raw.startsWith('/auth/')) return null;
    return raw;
  }

  /** Parámetros que se arrastran al registro, para no perder el destino al crear la cuenta. */
  protected readonly registroParams = this.returnUrl() ? { returnUrl: this.returnUrl()! } : {};

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.message.set(null);
    const { email, password } = this.form.getRawValue();
    const res = await this.supabase.signIn(email, password);
    this.submitting.set(false);
    if (res.ok) {
      // Decidir el destino por estado (pending / rejected / suspended / request-team /
      // request-pending / invitations / team)… salvo que el usuario venía de una pantalla
      // concreta: entonces se le devuelve allí (p. ej. la invitación del correo).
      const target = await this.access.refresh();
      await this.router.navigateByUrl(this.returnUrl() ?? target.route);
      return;
    }
    this.message.set({ kind: 'err', text: res.message ?? 'No se pudo iniciar sesión.' });
  }
}
