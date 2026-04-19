import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { AppConfigService } from '../../core/config/app-config.service';

export interface DownloadUrlResponse {
  url: string;
}

@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfigService);

  getDownloadUrl(token: string): Observable<DownloadUrlResponse> {
    const url = `${this.config.get().apiBaseUrl}/download/${token}`;
    return this.http.get<DownloadUrlResponse>(url);
  }

  resendDownloadLinks(email: string): Observable<void> {
    const url = `${this.config.get().apiBaseUrl}/purchases/redownload-resend`;
    return this.http.post<void>(url, { email });
  }
}
