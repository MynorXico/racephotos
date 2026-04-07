import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil, filter } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QRCodeComponent } from 'angularx-qrcode';

import { NavigationTitleService } from '../../../../core/services/navigation-title.service';
import { AppConfigService } from '../../../../core/config/app-config.service';
import { EventsActions } from '../../../../store/events/events.actions';
import {
  selectSelectedEvent,
  selectEventsLoading,
  selectEventsError,
} from '../../../../store/events/events.selectors';
import { EventArchiveDialogComponent } from '../event-archive-dialog/event-archive-dialog.component';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    QRCodeComponent,
  ],
  templateUrl: './event-detail.component.html',
  styleUrl: './event-detail.component.scss',
})
export class EventDetailComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(NavigationTitleService);
  private readonly configService = inject(AppConfigService);
  private readonly destroy$ = new Subject<void>();

  @ViewChild('qrCanvas', { read: ElementRef }) qrCanvasRef?: ElementRef;

  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), {
    initialValue: null,
  });
  readonly loading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });
  readonly error = toSignal(this.store.select(selectEventsError), { initialValue: null });

  readonly linkCopied = signal(false);

  private eventId = '';

  get publicUrl(): string {
    const base = this.configService.get().publicBaseUrl ?? window.location.origin;
    return `${base}/events/${this.eventId}`;
  }

  ngOnInit(): void {
    this.titleService.setTitle('Event Details');

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.eventId = params.get('id') ?? '';
      if (this.eventId) {
        this.store.dispatch(EventsActions.loadEvent({ id: this.eventId }));
      }
    });

    // Show snackbar on archive success.
    this.store
      .select(selectSelectedEvent)
      .pipe(
        filter((e) => e?.status === 'archived'),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.snackBar.open('Event archived. It is no longer visible in the public listing.', undefined, {
          duration: 5000,
        });
      });

    // Show snackbar on archive failure.
    this.store
      .select(selectEventsError)
      .pipe(
        filter((e): e is string => e !== null),
        takeUntil(this.destroy$),
      )
      .subscribe((error) => {
        if (error === 'forbidden' || error.includes('archive')) {
          this.snackBar.open('Could not archive the event. Please try again.', undefined, {
            duration: 6000,
          });
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onArchive(): void {
    const ev = this.selectedEvent();
    if (!ev) return;
    const dialogRef = this.dialog.open(EventArchiveDialogComponent, {
      maxWidth: '480px',
      data: { eventId: ev.id, eventName: ev.name },
    });
    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.store.dispatch(EventsActions.archiveEvent({ id: ev.id }));
      }
    });
  }

  onCopyLink(): void {
    void navigator.clipboard.writeText(this.publicUrl).then(() => {
      this.linkCopied.set(true);
      this.snackBar.open('Link copied to clipboard.', undefined, { duration: 2000 });
      setTimeout(() => this.linkCopied.set(false), 2000);
    });
  }

  onDownloadQr(): void {
    const canvas = document.querySelector('app-event-detail qrcode canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `racephotos-event-${this.eventId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  onRetry(): void {
    this.store.dispatch(EventsActions.loadEvent({ id: this.eventId }));
  }
}
