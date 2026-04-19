import {
  Component,
  Input,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { take } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { DownloadService } from './download.service';

@Component({
  selector: 'app-download-redirect',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule, MatIconModule, MatButtonModule],
  templateUrl: './download-redirect.component.html',
  styleUrl: './download-redirect.component.scss',
})
export class DownloadRedirectComponent implements OnInit {
  /**
   * Override the internal state for Storybook stories only.
   * In production this input is ignored — the component always starts
   * in 'loading' and transitions via the API response.
   */
  @Input() state: 'loading' | 'downloading' | 'error' = 'loading';

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly downloadService = inject(DownloadService);
  private readonly titleService = inject(Title);
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.titleService.setTitle('Downloading your photo — RaceShots');

    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.setError();
      return;
    }

    this.downloadService.getDownloadUrl(token).pipe(take(1)).subscribe({
      next: (res) => {
        // Trigger file download. With Content-Disposition: attachment the browser
        // starts the download without navigating away, so transition to 'downloading'.
        this.navigateTo(res.url);
        this.state = 'downloading';
        this.cdr.markForCheck();
      },
      error: (_err: HttpErrorResponse) => {
        this.setError();
      },
    });
  }

  onRequestNewLink(): void {
    this.router.navigate(['/redownload']);
  }

  // Extracted for testability — overridden by spy in unit tests.
  navigateTo(url: string): void {
    window.location.href = url;
  }

  private setError(): void {
    this.state = 'error';
    this.titleService.setTitle('Download error — RaceShots');
    this.cdr.markForCheck();
  }
}
