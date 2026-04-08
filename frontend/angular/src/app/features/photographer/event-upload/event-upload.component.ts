import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  inject,
  HostListener,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatListModule } from '@angular/material/list';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { EventsActions } from '../../../store/events/events.actions';
import {
  selectSelectedEvent,
  selectEventsLoading,
} from '../../../store/events/events.selectors';
import { PhotoUploadActions, FailedFile } from '../../../store/photo-upload/photo-upload.actions';
import {
  selectUploadTotal,
  selectUploadedCount,
  selectFailedFiles,
  selectUploadInProgress,
  selectPresignError,
  selectUploadComplete,
  selectHasFailures,
  selectUploadProgressPercent,
} from '../../../store/photo-upload/photo-upload.selectors';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

@Component({
  selector: 'app-event-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatListModule,
  ],
  templateUrl: './event-upload.component.html',
  styleUrl: './event-upload.component.scss',
})
export class EventUploadComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  private readonly titleService = inject(NavigationTitleService);
  private readonly destroy$ = new Subject<void>();

  /** Hidden file input for the "Browse files" button. */
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  /** "View photos" button — receives focus when upload completes. */
  @ViewChild('viewPhotosBtn') viewPhotosBtnRef?: ElementRef<HTMLButtonElement>;
  /** "Try again" button — receives focus when presign error appears. */
  @ViewChild('tryAgainBtn') tryAgainBtnRef?: ElementRef<HTMLButtonElement>;

  // ── Store selectors ──────────────────────────────────────────────────────────
  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), {
    initialValue: null,
  });
  readonly eventsLoading = toSignal(this.store.select(selectEventsLoading), {
    initialValue: false,
  });
  readonly uploadTotal = toSignal(this.store.select(selectUploadTotal), { initialValue: 0 });
  readonly uploadedCount = toSignal(this.store.select(selectUploadedCount), { initialValue: 0 });
  readonly failedFiles = toSignal(this.store.select(selectFailedFiles), { initialValue: [] });
  readonly uploadInProgress = toSignal(this.store.select(selectUploadInProgress), {
    initialValue: false,
  });
  readonly presignError = toSignal(this.store.select(selectPresignError), { initialValue: null });
  readonly uploadComplete = toSignal(this.store.select(selectUploadComplete), {
    initialValue: false,
  });
  readonly hasFailures = toSignal(this.store.select(selectHasFailures), { initialValue: false });
  readonly progressPercent = toSignal(this.store.select(selectUploadProgressPercent), {
    initialValue: 0,
  });

  // ── Component state ──────────────────────────────────────────────────────────
  isDragOver = false;
  eventId = '';

  /**
   * Cached last attempted file list — needed for "Try again" in the presign
   * error banner. Files are not serialisable to the store so we keep them here.
   */
  private lastAttemptedFiles: File[] = [];

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.titleService.setTitle('Upload Photos');

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.eventId = params.get('id') ?? '';
      if (this.eventId) {
        this.store.dispatch(EventsActions.loadEvent({ id: this.eventId }));
      }
    });

    // Focus management: move focus to "View photos" when upload completes cleanly.
    this.store
      .select(selectUploadComplete)
      .pipe(takeUntil(this.destroy$))
      .subscribe((complete) => {
        if (complete && !this.hasFailures()) {
          setTimeout(() => this.viewPhotosBtnRef?.nativeElement.focus(), 50);
        }
      });

    // Focus management: move focus to "Try again" when presign error appears.
    this.store
      .select(selectPresignError)
      .pipe(takeUntil(this.destroy$))
      .subscribe((err) => {
        if (err) {
          setTimeout(() => this.tryAgainBtnRef?.nativeElement.focus(), 50);
        }
      });
  }

  ngOnDestroy(): void {
    this.store.dispatch(PhotoUploadActions.resetUpload());
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Beforeunload guard ────────────────────────────────────────────────────────

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.uploadInProgress()) {
      event.preventDefault();
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
    const files = this.filterAccepted(Array.from(event.dataTransfer?.files ?? []));
    if (files.length > 0) {
      this.startUpload(files);
    }
  }

  onDropZoneKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.fileInputRef?.nativeElement.click();
    }
  }

  // ── File picker ───────────────────────────────────────────────────────────────

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = this.filterAccepted(Array.from(input.files ?? []));
    if (files.length > 0) {
      this.startUpload(files);
    }
    // Reset value so the same files can be re-selected after a failed upload.
    input.value = '';
  }

  openFilePicker(): void {
    this.fileInputRef?.nativeElement.click();
  }

  // ── Upload control ────────────────────────────────────────────────────────────

  onRetryFile(failedFile: FailedFile): void {
    this.store.dispatch(PhotoUploadActions.retryFile({ file: failedFile.file, eventId: this.eventId }));
  }

  onRetryAll(): void {
    const files = this.failedFiles().map((f) => f.file);
    this.startUpload(files);
  }

  onTryAgain(): void {
    if (this.lastAttemptedFiles.length > 0) {
      this.startUpload(this.lastAttemptedFiles);
    }
  }

  retryAriaLabel(filename: string): string {
    return `Retry upload for ${filename}`;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private startUpload(files: File[]): void {
    this.lastAttemptedFiles = files;
    this.store.dispatch(PhotoUploadActions.uploadFiles({ files, eventId: this.eventId }));
  }

  private filterAccepted(files: File[]): File[] {
    return files.filter((f) => ACCEPTED_TYPES.includes(f.type));
  }
}
