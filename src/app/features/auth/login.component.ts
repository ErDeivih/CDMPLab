import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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

  protected readonly submitting = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly emailInvalid = computed(() => this.form.controls.email.invalid && this.form.controls.email.touched);
  protected readonly passwordInvalid = computed(() => this.form.controls.password.invalid && this.form.controls.password.touched);

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
      // request-pending / invitations / team).
      const target = await this.access.refresh();
      await this.router.navigate([target.route]);
      return;
    }
    this.message.set({ kind: 'err', text: res.message ?? 'No se pudo iniciar sesión.' });
  }
}
