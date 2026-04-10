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
  processing: { cssClass: 'badge--processing', icon: 'hourglass_top', label: 'Processing' },
  watermarking: { cssClass: 'badge--watermarking', icon: 'autorenew', label: 'Finalizing' },
};

const FALLBACK: BadgeConfig = BADGE_MAP['processing'];

@Pipe({ name: 'photoStatusBadge', standalone: true })
export class PhotoStatusBadgePipe implements PipeTransform {
  transform(status: string): BadgeConfig {
    return BADGE_MAP[status as PhotoStatus] ?? FALLBACK;
  }
}
