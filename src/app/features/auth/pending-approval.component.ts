import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-pending-approval',
  templateUrl: './pending-approval.component.html',
  imports: [AuthCardComponent],
})
export class PendingApprovalComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  protected readonly email = computed(() => this.supabase.user()?.email ?? '');
  protected readonly displayName = computed(() => this.supabase.profile()?.displayName ?? '');

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.router.navigate(['/auth/login']);
  }
}
