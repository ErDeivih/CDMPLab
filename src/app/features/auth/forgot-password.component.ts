import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  imports: [ReactiveFormsModule, RouterLink, AuthCardComponent],
})
export class ForgotPasswordComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly supabase = inject(SupabaseService);

  protected readonly submitting = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly emailInvalid = computed(() => this.form.controls.email.invalid && this.form.controls.email.touched);

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.message.set(null);
    const res = await this.supabase.resetPassword(this.form.getRawValue().email);
    this.submitting.set(false);
    this.message.set({ kind: res.ok ? 'ok' : 'err', text: res.message ?? 'No se pudo enviar el restablecimiento.' });
  }
}
