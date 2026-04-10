import { PhotoStatusBadgePipe } from './photo-status-badge.pipe';

describe('PhotoStatusBadgePipe', () => {
  let pipe: PhotoStatusBadgePipe;

  beforeEach(() => {
    pipe = new PhotoStatusBadgePipe();
  });

  it('returns indexed badge config', () => {
    const cfg = pipe.transform('indexed');
    expect(cfg.cssClass).toBe('badge--indexed');
    expect(cfg.icon).toBe('check_circle');
    expect(cfg.label).toBe('Indexed');
  });

  it('returns review_required badge config', () => {
    const cfg = pipe.transform('review_required');
    expect(cfg.cssClass).toBe('badge--review');
    expect(cfg.icon).toBe('rate_review');
    expect(cfg.label).toBe('Review Required');
  });

  it('returns error badge config', () => {
    const cfg = pipe.transform('error');
    expect(cfg.cssClass).toBe('badge--error');
    expect(cfg.icon).toBe('error');
    expect(cfg.label).toBe('Error');
  });

  it('returns processing badge config — label is "In Progress" (RS-018)', () => {
    const cfg = pipe.transform('processing');
    expect(cfg.cssClass).toBe('badge--processing');
    expect(cfg.icon).toBe('hourglass_top');
    expect(cfg.label).toBe('In Progress');
  });

  it('returns watermarking badge config — same as processing after RS-018', () => {
    const cfg = pipe.transform('watermarking');
    expect(cfg.cssClass).toBe('badge--processing');
    expect(cfg.icon).toBe('hourglass_top');
    expect(cfg.label).toBe('In Progress');
  });

  it('falls back to processing for unknown status', () => {
    const cfg = pipe.transform('unknown_status');
    expect(cfg.cssClass).toBe('badge--processing');
  });
});
