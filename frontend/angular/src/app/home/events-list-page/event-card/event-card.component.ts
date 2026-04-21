import { Component, EventEmitter, HostListener, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { PublicEvent } from '../../../features/photographer/events/event.model';

@Component({
  selector: 'app-event-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'listitem',
    tabindex: '0',
    class: 'event-card-host',
  },
  imports: [DatePipe, MatCardModule, MatButtonModule, MatIconModule],
  templateUrl: './event-card.component.html',
  styleUrl: './event-card.component.scss',
})
export class EventCardComponent {
  @Input({ required: true }) event!: PublicEvent;
  @Output() cardClick = new EventEmitter<string>();

  @HostListener('click')
  onHostClick(): void {
    this.cardClick.emit(this.event.id);
  }

  @HostListener('keydown.enter', ['$event'])
  @HostListener('keydown.space', ['$event'])
  onKeyActivate(e: KeyboardEvent): void {
    e.preventDefault();
    this.cardClick.emit(this.event.id);
  }

  onSearchClick(e: MouseEvent): void {
    e.stopPropagation();
    this.cardClick.emit(this.event.id);
  }
}
