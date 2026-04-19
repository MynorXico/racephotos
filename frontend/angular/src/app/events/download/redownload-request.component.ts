import {
  Component,
  Input,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { take } from 'rxjs';

import { DownloadService } from './download.service';

@Component({
  selector: 'app-redownload-request',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './redownload-request.component.html',
  styleUrl: './redownload-request.component.scss',
})
export class RedownloadRequestComponent implements OnInit {
  /**
   * Override the initial submit state for Storybook stories only.
   * In production this input is ignored after construction.
   */
  @Input() submitState: 'idle' | 'loading' | 'success' | 'rate-limited' | 'error' = 'idle';

  readonly emailControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });

  private readonly downloadService = inject(DownloadService);
  private readonly titleService = inject(Title);
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.titleService.setTitle('Resend download links — RaceShots');
  }

  get isLoading(): boolean {
    return this.submitState === 'loading';
  }

  onSubmit(): void {
    this.emailControl.markAllAsTouched();
    if (this.emailControl.invalid || this.isLoading) return;

    this.submitState = 'loading';
    this.emailControl.disable();
    this.cdr.markForCheck();

    this.downloadService.resendDownloadLinks(this.emailControl.value).pipe(take(1)).subscribe({
      next: () => {
        this.submitState = 'success';
        this.emailControl.enable();
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.submitState = err.status === 429 ? 'rate-limited' : 'error';
        this.emailControl.enable();
        this.cdr.markForCheck();
      },
    });
  }
}
