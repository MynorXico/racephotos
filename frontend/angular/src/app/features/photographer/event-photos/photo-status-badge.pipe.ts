import { Pipe, PipeTransform } from '@angular/core';
import { PhotoStatus } from '../../../store/photos/photos.actions';

export interface BadgeConfig {
  cssClass: string;
  icon: string;
  label: string;
}

const BADGE_MAP: Record<PhotoStatus, BadgeConfig> = {
  indexed: { cssClass: 'badge--indexed', icon: 'check_circle', label: 'Indexed' },
  review_required: { cssClass: 'badge--review', icon: 'rate_review', label: 'Review Required' },
  error: { cssClass: 'badge--error', icon: 'error', label: 'Error' },
  // Both processing and watermarking show "In Progress" — the filter chip
  // aggregates them under a single 'in_progress' alias (RS-018). The shimmer
  // animation on watermarking thumbnails (RS-017) still differentiates the two
  // states at the card level.
  processing: { cssClass: 'badge--processing', icon: 'hourglass_top', label: 'In Progress' },
  watermarking: { cssClass: 'badge--processing', icon: 'hourglass_top', label: 'In Progress' },
};

const FALLBACK: BadgeConfig = BADGE_MAP['processing'];

@Pipe({ name: 'photoStatusBadge', standalone: true })
export class PhotoStatusBadgePipe implements PipeTransform {
  transform(status: string): BadgeConfig {
    return BADGE_MAP[status as PhotoStatus] ?? FALLBACK;
  }
}
