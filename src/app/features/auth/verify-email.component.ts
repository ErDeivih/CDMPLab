import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.component.html',
  imports: [RouterLink, AuthCardComponent],
})
export class VerifyEmailComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly resending = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  constructor() {
    this.email.set(this.route.snapshot.queryParamMap.get('email') ?? '');
  }

  async resend(): Promise<void> {
    const email = this.email();
    if (!email) {
      this.message.set({ kind: 'err', text: 'No hay un correo para reenviar.' });
      return;
    }
    this.resending.set(true);
    const res = await this.supabase.resendConfirmation(email);
    this.resending.set(false);
    this.message.set({ kind: res.ok ? 'ok' : 'err', text: res.message ?? 'No se pudo reenviar el correo.' });
  }
}
