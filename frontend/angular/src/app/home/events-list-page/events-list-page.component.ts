import {
  Component,
  OnInit,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Title } from '@angular/platform-browser';

import { PublicEventsActions } from '../../store/events/events.actions';
import {
  selectPublicEvents,
  selectPublicEventsLoading,
  selectPublicEventsError,
  selectHasMorePublicEvents,
  selectPublicNextCursor,
} from '../../store/events/events.selectors';
import { EventCardComponent } from './event-card/event-card.component';
import { LanguageSwitcherComponent } from '../../shared/language-switcher/language-switcher.component';

@Component({
  selector: 'app-events-list-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    EventCardComponent,
    LanguageSwitcherComponent,
  ],
  templateUrl: './events-list-page.component.html',
  styleUrl: './events-list-page.component.scss',
})
export class EventsListPageComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);

  readonly events = toSignal(this.store.select(selectPublicEvents), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectPublicEventsLoading), { initialValue: false });
  readonly error = toSignal(this.store.select(selectPublicEventsError), { initialValue: null });
  readonly hasMore = toSignal(this.store.select(selectHasMorePublicEvents), { initialValue: false });
  readonly nextCursor = toSignal(this.store.select(selectPublicNextCursor), { initialValue: null });

  readonly skeletons = Array(6);

  ngOnInit(): void {
    this.titleService.setTitle('RaceShots — Find your race photos');
    this.store.dispatch(PublicEventsActions.listPublicEvents({}));
  }

  onLoadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.store.dispatch(PublicEventsActions.listPublicEvents({ cursor }));
    }
  }

  onRetry(): void {
    this.store.dispatch(PublicEventsActions.listPublicEvents({}));
  }

  onCardClick(eventId: string): void {
    void this.router.navigate(['/events', eventId]);
  }
}
