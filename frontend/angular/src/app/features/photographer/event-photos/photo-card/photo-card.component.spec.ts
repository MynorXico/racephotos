import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PhotoCardComponent } from './photo-card.component';
import { Photo } from '../../../../store/photos/photos.actions';

const basePhoto: Photo = {
  id: 'photo-1',
  status: 'indexed',
  thumbnailUrl: 'https://cdn.example.com/photo-1.jpg',
  bibNumbers: ['101', '202'],
  uploadedAt: '2026-04-01T10:00:00Z',
  errorReason: null,
};

describe('PhotoCardComponent', () => {
  let fixture: ComponentFixture<PhotoCardComponent>;
  let component: PhotoCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, PhotoCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PhotoCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('photo', basePhoto);
    fixture.detectChanges();
  });

  it('renders the thumbnail when thumbnailUrl is set', () => {
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.src).toContain('photo-1.jpg');
  });

  it('shows processing placeholder when thumbnailUrl is null', () => {
    fixture.componentRef.setInput('photo', { ...basePhoto, thumbnailUrl: null, status: 'processing' });
    fixture.detectChanges();
    const placeholder: HTMLElement = fixture.nativeElement.querySelector('.thumbnail-placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder.getAttribute('aria-label')).toBe('Thumbnail not yet available');
  });

  it('shows broken_image placeholder after image load error', () => {
    component.onImageError();
    fixture.detectChanges();
    const placeholder: HTMLElement = fixture.nativeElement.querySelector('.thumbnail-placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder.getAttribute('aria-label')).toBe('Thumbnail unavailable');
  });

  it('renders bib numbers', () => {
    const bibRow: HTMLElement = fixture.nativeElement.querySelector('.bib-row');
    expect(bibRow.textContent).toContain('101');
    expect(bibRow.textContent).toContain('202');
  });

  it('renders "No bibs detected" when bibNumbers is empty', () => {
    fixture.componentRef.setInput('photo', { ...basePhoto, bibNumbers: [] });
    fixture.detectChanges();
    const bibRow: HTMLElement = fixture.nativeElement.querySelector('.bib-row');
    expect(bibRow.textContent).toContain('No bibs detected');
  });

  it('shows error info button for error-status photos', () => {
    fixture.componentRef.setInput('photo', {
      ...basePhoto,
      status: 'error',
      errorReason: 'Timeout',
    });
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.error-info-btn');
    expect(btn).toBeTruthy();
  });

  it('does not show error info button for indexed-status photos', () => {
    const btn = fixture.nativeElement.querySelector('.error-info-btn');
    expect(btn).toBeNull();
  });

  it('errorTooltip returns errorReason when set', () => {
    fixture.componentRef.setInput('photo', {
      ...basePhoto,
      status: 'error',
      errorReason: 'Rekognition timeout',
    });
    expect(component.errorTooltip).toBe('Rekognition timeout');
  });

  it('errorTooltip returns fallback when errorReason is null', () => {
    fixture.componentRef.setInput('photo', { ...basePhoto, status: 'error', errorReason: null });
    expect(component.errorTooltip).toBe('No error details available.');
  });
});
