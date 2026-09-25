import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BoardSessionService } from '../../core/board-session.service';
import { StoreService } from '../../core/store.service';
import { ExerciseBoardGuard } from './exercise-board.guard';

describe('ExerciseBoardGuard', () => {
  let remote = true;
  beforeEach(() => {
    remote = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StoreService, useValue: { isRemote: () => remote } },
      ],
    });
  });

  it('envía a Biblioteca al entrar directamente en la pizarra de la cuenta', () => {
    const guard = TestBed.inject(ExerciseBoardGuard);
    const router = TestBed.inject(Router);
    expect(guard.canActivate()).toEqual(router.parseUrl('/library'));
  });

  it('permite abrir el ejercicio que se eligió en Biblioteca', () => {
    const session = TestBed.inject(BoardSessionService);
    session.open('ejercicio-1', null);
    expect(TestBed.inject(ExerciseBoardGuard).canActivate()).toBe(true);
  });

  it('conserva la ruta directa del modo local de desarrollo', () => {
    remote = false;
    expect(TestBed.inject(ExerciseBoardGuard).canActivate()).toBe(true);
  });
});
