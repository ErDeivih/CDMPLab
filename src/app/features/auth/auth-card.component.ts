import { Component, ViewEncapsulation, input } from '@angular/core';

/** Tarjeta centrada reutilizable para las pantallas de autenticación. */
@Component({
  selector: 'app-auth-card',
  templateUrl: './auth-card.component.html',
  styleUrl: './auth.scss',
  // Esta tarjeta estiliza también el contenido proyectado de cada formulario.
  encapsulation: ViewEncapsulation.None,
})
export class AuthCardComponent {
  readonly title = input('');
  readonly subtitle = input('');
}
