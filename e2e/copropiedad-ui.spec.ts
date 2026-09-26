import { expect, test } from '@playwright/test';
import type { TeamMemberInfo } from '../src/app/core/repositories/data-source';

// Prueba VISUAL e interacción del componente real con respuestas de servicio simuladas.
// Los permisos reales se verifican por separado en supabase/tests/coownership.sql.
for (const width of [390, 1366]) {
  test(`copropiedad: confirmar sin traspasar, controles legibles y siete plazas (${width})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/settings/team/members');
    await expect(page.locator('.auth-title')).toHaveText('Miembros del equipo');
    await page.evaluate(async () => {
      interface Component {
        access: {
          _resolution: { set(value: unknown): void };
          listMembers: () => Promise<TeamMemberInfo[]>;
          listTeamInvitations: () => Promise<[]>;
          setMemberRole: (id: string, role: 'owner' | 'editor') => Promise<void>;
        };
        store: { isRemote: () => boolean };
        supabase: { _session: { set(value: unknown): void } };
        load: () => Promise<void>;
      }
      const ng = (
        window as unknown as {
          ng: { getComponent(node: Element): Component; applyChanges(component: Component): void };
        }
      ).ng;
      const component = ng.getComponent(document.querySelector('app-members')!);
      const team = {
        id: 'fixture-team',
        name: 'Juvenil B',
        accentColor: '#c8102e',
        createdAt: '2026-01-01',
        role: 'owner',
      };
      component.access._resolution.set({
        profile: { userId: 'owner', status: 'approved' },
        ownedTeam: team,
        membership: null,
        accessibleTeams: [team],
        pendingInvitations: [],
        teamRequest: null,
      });
      component.supabase._session.set({ user: { id: 'owner', email: 'owner@example.com' } });
      component.store.isRemote = () => true;
      let people: TeamMemberInfo[] = [
        { userId: 'owner', displayName: 'Ana', role: 'owner' as const },
        { userId: 'second', displayName: 'Luis', role: 'owner' as const },
        { userId: 'editor', displayName: 'Eva', role: 'editor' as const },
      ].map((p) => ({
        ...p,
        emailNormalized: `${p.userId}@example.com`,
        status: 'active',
        invitedBy: null,
        acceptedAt: null,
      }));
      component.access.listMembers = async () => people;
      component.access.listTeamInvitations = async () => [];
      component.access.setMemberRole = async (id, role) => {
        people = people.map((p) => (p.userId === id ? { ...p, role } : p));
      };
      await component.load();
      ng.applyChanges(component);
    });
    await expect(page.locator('.members-capacity')).toContainText('3 de 7 usadas');
    const eva = page.locator('.invite-row').filter({ hasText: 'Eva' });
    await eva.getByRole('button', { name: 'Hacer copropietario', exact: true }).click();
    // ConfirmService usa alertdialog para estas decisiones de permisos, no dialog.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Tú conservarás tus permisos');
    await dialog.getByRole('button', { name: 'Hacer copropietario', exact: true }).click();
    await expect(eva).toContainText('Copropietario');
    await expect(page.locator('.invite-row').filter({ hasText: 'Ana' })).toContainText(
      'Copropietario',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    for (const button of await page.locator('[data-accion="copropiedad"]').all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box?.height).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({ path: info.outputPath(`copropiedad-${width}.png`), fullPage: true });
  });
}
