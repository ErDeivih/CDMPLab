import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AccessService } from '../../core/access.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-access-rejected',
  templateUrl: './access-rejected.component.html',
  imports: [AuthCardComponent],
})
export class AccessRejectedComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  protected readonly email = computed(() => this.supabase.user()?.email ?? '');

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }
}
