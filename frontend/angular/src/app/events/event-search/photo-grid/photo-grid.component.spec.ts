import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RunnerPhotoGridComponent } from './photo-grid.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';

const photos: RunnerPhoto[] = [
  { photoId: 'p1', watermarkedUrl: 'https://cdn.example.com/p1.jpg', capturedAt: null },
  { photoId: 'p2', watermarkedUrl: 'https://cdn.example.com/p2.jpg', capturedAt: null },
];

describe('RunnerPhotoGridComponent', () => {
  let fixture: ComponentFixture<RunnerPhotoGridComponent>;
  let component: RunnerPhotoGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, RunnerPhotoGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RunnerPhotoGridComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('photos', photos);
    fixture.componentRef.setInput('pricePerPhoto', 9.99);
    fixture.componentRef.setInput('currency', 'EUR');
    fixture.detectChanges();
  });

  it('renders one card per photo', () => {
    const cards = fixture.nativeElement.querySelectorAll('app-runner-photo-card');
    expect(cards.length).toBe(2);
  });

  it('has role="list" on the grid container', () => {
    const grid: HTMLElement = fixture.nativeElement.querySelector('.photo-grid');
    expect(grid.getAttribute('role')).toBe('list');
  });

  it('sets aria-label with bib number when searchedBib is provided', () => {
    fixture.componentRef.setInput('searchedBib', '42');
    fixture.detectChanges();
    const grid: HTMLElement = fixture.nativeElement.querySelector('.photo-grid');
    expect(grid.getAttribute('aria-label')).toBe('Photos for bib 42');
  });

  it('re-emits photoSelected from child cards', () => {
    const emitted: string[] = [];
    component.photoSelected.subscribe((id) => emitted.push(id));
    component.photoSelected.emit('p1');
    expect(emitted).toContain('p1');
  });
});
