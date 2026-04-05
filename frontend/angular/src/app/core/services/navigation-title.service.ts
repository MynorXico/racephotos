import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * NavigationTitleService — provides the page title for PhotographerLayoutComponent.
 *
 * Child components call setTitle() on init; the layout subscribes to title$.
 * Lightweight BehaviorSubject; no NgRx needed for this UI-only concern (UX-D5).
 */
@Injectable({ providedIn: 'root' })
export class NavigationTitleService {
  private readonly _title$ = new BehaviorSubject<string>('');
  readonly title$ = this._title$.asObservable();

  setTitle(title: string): void {
    this._title$.next(title);
  }
}
