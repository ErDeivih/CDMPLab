import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AccessService } from './access.service';
import { StoreService } from './store.service';
import { SupabaseService } from './supabase.service';
import type { TeamInvitationInfo } from './repositories/data-source';

describe('AccessService invitations', () => {
  it('permite consultar invitaciones antes de pertenecer a un equipo', async () => {
    const invitation: TeamInvitationInfo = {
      id: 'inv-1',
      teamId: 'team-1',
      teamName: 'Primer equipo',
      emailNormalized: 'invitado@example.com',
      invitedUserId: 'user-1',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    const repo = {
      teamId: null,
      myPendingInvitations: vi.fn().mockResolvedValue([invitation]),
    };

    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: {} },
        { provide: StoreService, useValue: {} },
      ],
    });
    const service = TestBed.inject(AccessService);
    (service as unknown as { _repo: typeof repo })._repo = repo;

    await expect(service.listInvitations()).resolves.toEqual([invitation]);
    expect(repo.myPendingInvitations).toHaveBeenCalledOnce();
  });
});
