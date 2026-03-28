import { Injectable } from '@angular/core';
import { AppConfig } from './app-config.model';

/**
 * Holds the runtime configuration loaded from /assets/config.json.
 *
 * Do not inject this service before APP_INITIALIZER has resolved — the config
 * will be undefined. All consumers that run after bootstrap are safe.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config!: AppConfig;

  /** Called once by APP_INITIALIZER in app.config.ts. */
  async load(): Promise<void> {
    const response = await fetch('/assets/config.json');
    if (!response.ok) {
      throw new Error(`Failed to load runtime config: ${response.status} ${response.statusText}`);
    }
    this.config = (await response.json()) as AppConfig;
  }

  get(): AppConfig {
    return this.config;
  }
}
