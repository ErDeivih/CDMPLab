import { Component, inject } from '@angular/core';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-confirm',
  styleUrl: './confirm-dialog.component.scss',
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  private readonly confirmSvc = inject(ConfirmService);
  protected readonly state = this.confirmSvc.state;

  protected confirm(): void {
    this.confirmSvc.confirm();
  }
  protected cancel(): void {
    this.confirmSvc.cancel();
  }
}
