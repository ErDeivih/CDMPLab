import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CanvasFrame, FieldType } from '../../core/models';
import { renderBoardSvg } from '../../core/render';
import { exportPng } from '../../core/canvas-export';

type Orientation = 'landscape' | 'portrait';

@Component({
  selector: 'app-export-dialog',
  styleUrl: './export-dialog.component.scss',
  templateUrl: './export-dialog.component.html',
})
export class ExportDialogComponent implements OnInit {
  private readonly sanitizer = inject(DomSanitizer);

  readonly field = input.required<FieldType>();
  readonly frames = input.required<CanvasFrame[]>();
  readonly backgroundColor = input('#31834a');
  readonly lineColor = input('#ffffff');
  readonly title = input('ejercicio');
  readonly fieldOrientation = input<'horizontal' | 'vertical'>('horizontal');
  readonly grid = input(false);
  readonly guide = input<'none' | '2x2' | '3x3' | 'thirds' | 'lanes'>('none');
  readonly grass = input<'stripes' | 'plain' | 'checker'>('stripes');
  readonly closed = output<void>();

  protected readonly name = signal('');

  ngOnInit(): void {
    this.name.set(this.title());
  }

  protected readonly orientation = signal<Orientation>('landscape');
  protected readonly resolution = signal(720);
  protected readonly transparent = signal(false);

  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly preview = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      renderBoardSvg(this.field(), this.frames()[0]?.elements ?? [], {
        backgroundColor: this.transparent() ? undefined : this.backgroundColor(),
        lineColor: this.lineColor(),
        orientation: this.fieldOrientation(),
        grid: this.grid(),
        guide: this.guide(),
        grass: this.grass(),
      })
    )
  );

  protected readonly size = computed(() => {
    const res = this.resolution();
    const aspect = 0.8;
    if (this.orientation() === 'landscape') return { width: res, height: Math.round(res * aspect) };
    return { width: Math.round(res * aspect), height: res };
  });

  protected keepOpen(event: Event): void {
    event.stopPropagation();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected async doExport(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.error.set(null);
    const s = this.size();
    try {
      const dataUrl = await exportPng(this.field(), this.frames()[0]?.elements ?? [], {
        width: s.width,
        height: s.height,
        backgroundColor: this.backgroundColor(),
        lineColor: this.lineColor(),
        transparent: this.transparent(),
        orientation: this.fieldOrientation(),
        grid: this.grid(),
        guide: this.guide(),
        grass: this.grass(),
      });
      this.download(dataUrl, `${this.safeName()}.png`, false);
    } catch {
      this.error.set('No se pudo exportar. Reinténtalo.');
    } finally {
      this.exporting.set(false);
    }
  }

  protected cancel(): void {
    this.close();
  }

  private safeName(): string {
    return (this.name() || this.title() || 'cdmplab').replace(/[^\w\-. ]+/g, '').trim() || 'cdmplab';
  }

  private download(url: string, name: string, revoke: boolean): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    if (revoke) URL.revokeObjectURL(url);
  }
}
