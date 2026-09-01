import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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

  protected readonly submitting = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    passwordConfirm: ['', [Validators.required]],
  });

  protected readonly emailInvalid = computed(() => this.form.controls.email.invalid && this.form.controls.email.touched);
  protected readonly passwordInvalid = computed(() => this.form.controls.password.invalid && this.form.controls.password.touched);
  protected readonly confirmInvalid = computed(() => {
    const c = this.form.controls.passwordConfirm;
    return c.invalid && c.touched;
  });
  protected readonly mismatch = computed(
    () => this.form.controls.passwordConfirm.touched && this.form.controls.password.value !== this.form.controls.passwordConfirm.value
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
        await this.router.navigate(['/auth/verify-email'], { queryParams: { email } });
        return;
      }
      await this.router.navigate(['/team']);
      return;
    }
    this.message.set({ kind: 'err', text: res.message ?? 'No se pudo crear la cuenta.' });
  }
}
