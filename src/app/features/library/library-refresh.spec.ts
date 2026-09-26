import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryComponent } from './library.component';
import { StoreService } from '../../core/store.service';
import { BoardSessionService } from '../../core/board-session.service';
import { ConfirmService } from '../../core/confirm.service';

interface RefreshHarness {
  refreshLibrary(automatic?: boolean): Promise<void>;
  refreshMessage: WritableSignal<string>;
  refreshing: WritableSignal<boolean>;
  editorOpen: WritableSignal<boolean>;
  renameTarget: WritableSignal<string | null>;
  newChildParent: WritableSignal<string | null>;
}

describe('Biblioteca: actualización remota sin perder edición', () => {
  const pendingWrites = signal(0);
  const lastError = signal<string | null>(null);
  const refreshRemoteData = vi.fn<(canApply: () => boolean) => Promise<boolean>>();
  let component: LibraryComponent;
  let harness: RefreshHarness;

  beforeEach(() => {
    pendingWrites.set(0);
    lastError.set(null);
    refreshRemoteData.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: StoreService,
          useValue: {
            isRemote: () => true,
            activeTeam: signal(null),
            pendingWrites,
            lastError,
            refreshRemoteData,
          },
        },
        { provide: Router, useValue: {} },
        { provide: BoardSessionService, useValue: {} },
        { provide: ConfirmService, useValue: {} },
      ],
    });
    component = TestBed.runInInjectionContext(() => new LibraryComponent());
    harness = component as unknown as RefreshHarness;
  });

  it('informa del resultado y termina el estado de carga', async () => {
    await harness.refreshLibrary();
    expect(refreshRemoteData).toHaveBeenCalledOnce();
    expect(harness.refreshMessage()).toContain('Biblioteca actualizada');
    expect(harness.refreshing()).toBe(false);
  });

  it('no consulta mientras hay un editor o un nombre de carpeta en edición', async () => {
    harness.editorOpen.set(true);
    await harness.refreshLibrary();
    harness.editorOpen.set(false);
    harness.renameTarget.set('folder');
    await harness.refreshLibrary();
    harness.renameTarget.set(null);
    harness.newChildParent.set('root');
    await harness.refreshLibrary();
    expect(refreshRemoteData).not.toHaveBeenCalled();
    expect(harness.refreshMessage()).toContain('Termina la edición');
  });

  it('no consulta durante escrituras pendientes ni errores de guardado', async () => {
    pendingWrites.set(1);
    await harness.refreshLibrary();
    pendingWrites.set(0);
    lastError.set('sin conexión');
    await harness.refreshLibrary();
    expect(refreshRemoteData).not.toHaveBeenCalled();
  });

  it('la guarda entregada al store invalida una respuesta si se abre el editor', async () => {
    refreshRemoteData.mockImplementation(async (canApply) => {
      expect(canApply()).toBe(true);
      harness.editorOpen.set(true);
      expect(canApply()).toBe(false);
      return false;
    });
    await harness.refreshLibrary();
    expect(harness.refreshMessage()).toContain('Hay cambios en curso');
  });

  it('salir de Biblioteca invalida la respuesta y no muestra éxito tardío', async () => {
    refreshRemoteData.mockImplementation(async (canApply) => {
      component.ngOnDestroy();
      expect(canApply()).toBe(false);
      return false;
    });
    await harness.refreshLibrary();
    expect(harness.refreshMessage()).toBe('');
  });

  it('un error de red queda visible y permite reintentar', async () => {
    refreshRemoteData.mockRejectedValueOnce(new Error('Sin conexión'));
    await harness.refreshLibrary(true);
    expect(harness.refreshMessage()).toBe('Sin conexión');
    expect(harness.refreshing()).toBe(false);
    await harness.refreshLibrary();
    expect(refreshRemoteData).toHaveBeenCalledTimes(2);
    expect(harness.refreshMessage()).toContain('Biblioteca actualizada');
  });
});
