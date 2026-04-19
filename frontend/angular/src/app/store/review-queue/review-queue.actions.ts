import { createActionGroup, props } from '@ngrx/store';

export interface ReviewPhoto {
  id: string;
  /** review_required | error on initial load; may become indexed after a successful save */
  status: 'review_required' | 'error' | 'indexed';
  thumbnailUrl: string | null;
  bibNumbers: string[];
  uploadedAt: string;
  errorReason: string | null;
}

export const ReviewQueueActions = createActionGroup({
  source: 'ReviewQueue',
  events: {
    'Load Review Queue': props<{ eventId: string }>(),
    'Load Review Queue Success': props<{ photos: ReviewPhoto[] }>(),
    'Load Review Queue Failure': props<{ error: string }>(),

    'Save Photo Bibs': props<{ photoId: string; bibNumbers: string[] }>(),
    'Save Photo Bibs Success': props<{ photoId: string; updatedPhoto: ReviewPhoto }>(),
    'Save Photo Bibs Failure': props<{ photoId: string; error: string }>(),
  },
});
