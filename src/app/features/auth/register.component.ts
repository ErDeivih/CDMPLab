import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  imports: [ReactiveFormsModule, RouterLink, AuthCardComponent],
})
export class RegisterComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly submitting = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  /**
   * Destino al que volver tras crear la cuenta y confirmar el correo (`?returnUrl=`), si es una
   * ruta INTERNA. Se arrastra desde el login para que quien llega por el enlace de una invitación
   * no pierda de vista dónde iba: el enlace del correo apunta a `/invitations?invitation=…`.
   */
  private readonly returnUrl = ((): string | null => {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    if (raw.startsWith('/auth/')) return null;
    return raw;
  })();

  /** Lo que viaja a la pantalla siguiente (confirmación del correo). */
  protected readonly siguienteDestino = this.returnUrl ?? '';

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    passwordConfirm: ['', [Validators.required]],
  });

  protected readonly emailInvalid = computed(
    () => this.form.controls.email.invalid && this.form.controls.email.touched,
  );
  protected readonly passwordInvalid = computed(
    () => this.form.controls.password.invalid && this.form.controls.password.touched,
  );
  protected readonly confirmInvalid = computed(() => {
    const c = this.form.controls.passwordConfirm;
    return c.invalid && c.touched;
  });
  protected readonly mismatch = computed(
    () =>
      this.form.controls.passwordConfirm.touched &&
      this.form.controls.password.value !== this.form.controls.passwordConfirm.value,
  );

  async submit(): Promise<void> {
    if (this.form.invalid || this.mismatch()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.message.set(null);
    const { email, password } = this.form.getRawValue();
    const res = await this.supabase.signUp(email, password);
    this.submitting.set(false);
    if (res.ok) {
      if (res.needsVerification) {
        // El destino se arrastra: al confirmar el correo el usuario vuelve a iniciar sesión y
        // aterriza donde iba (p. ej. la invitación que le enviaron).
        await this.router.navigate(['/auth/verify-email'], {
          queryParams: this.returnUrl ? { email, returnUrl: this.returnUrl } : { email },
        });
        return;
      }
      await this.router.navigateByUrl(this.returnUrl ?? '/team');
      return;
    }
    this.message.set({ kind: 'err', text: res.message ?? 'No se pudo crear la cuenta.' });
  }
}
