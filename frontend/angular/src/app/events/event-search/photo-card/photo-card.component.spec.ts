import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RunnerPhotoCardComponent } from './photo-card.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';

const basePhoto: RunnerPhoto = {
  photoId: 'photo-1',
  watermarkedUrl: 'https://cdn.example.com/photo-1.jpg',
  capturedAt: '2026-04-01T10:00:00Z',
};

describe('RunnerPhotoCardComponent', () => {
  let fixture: ComponentFixture<RunnerPhotoCardComponent>;
  let component: RunnerPhotoCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, RunnerPhotoCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RunnerPhotoCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('photo', basePhoto);
    fixture.componentRef.setInput('pricePerPhoto', 12.99);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.detectChanges();
  });

  it('renders the watermarked thumbnail', () => {
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.src).toContain('photo-1.jpg');
  });

  it('shows broken_image placeholder after image load error', () => {
    component.onImageError();
    fixture.detectChanges();
    const placeholder: HTMLElement =
      fixture.nativeElement.querySelector('.thumbnail-placeholder');
    expect(placeholder).toBeTruthy();
  });

  it('hides the img element after image load error', () => {
    component.onImageError();
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeNull();
  });

  it('renders price per photo', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('USD');
    expect(text).toContain('12.99');
  });

  it('builds correct altText when searchedBib is set', () => {
    fixture.componentRef.setInput('searchedBib', '101');
    expect(component.altText).toBe('Race photo for bib 101');
  });

  it('builds generic altText when searchedBib is empty', () => {
    expect(component.altText).toBe('Race photo');
  });

  it('emits photoSelected on card click', () => {
    const emitted: string[] = [];
    component.photoSelected.subscribe((id) => emitted.push(id));
    component.onCardClick();
    expect(emitted).toEqual(['photo-1']);
  });

  it('emits photoSelected on Enter key via host binding', () => {
    const emitted: string[] = [];
    component.photoSelected.subscribe((id) => emitted.push(id));
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(emitted).toEqual(['photo-1']);
  });
});
