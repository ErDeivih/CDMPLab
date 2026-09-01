import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-update-password',
  templateUrl: './update-password.component.html',
  imports: [ReactiveFormsModule, RouterLink, AuthCardComponent],
})
export class UpdatePasswordComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    passwordConfirm: ['', [Validators.required]],
  });

  protected readonly passwordInvalid = computed(() => this.form.controls.password.invalid && this.form.controls.password.touched);
  protected readonly mismatch = computed(
    () => this.form.controls.passwordConfirm.touched && this.form.controls.password.value !== this.form.controls.passwordConfirm.value
  );
  protected readonly noSession = computed(() => this.supabase.status() === 'unauthenticated');

  async submit(): Promise<void> {
    if (this.form.invalid || this.mismatch()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.message.set(null);
    const res = await this.supabase.updatePassword(this.form.getRawValue().password);
    this.submitting.set(false);
    if (res.ok) {
      await this.router.navigate(['/team']);
      return;
    }
    this.message.set({ kind: 'err', text: res.message ?? 'No se pudo actualizar la contraseña.' });
  }
}
