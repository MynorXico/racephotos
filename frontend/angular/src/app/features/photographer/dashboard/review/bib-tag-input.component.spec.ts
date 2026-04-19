import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { BibTagInputComponent } from './bib-tag-input.component';

describe('BibTagInputComponent', () => {
  let fixture: ComponentFixture<BibTagInputComponent>;
  let component: BibTagInputComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BibTagInputComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(BibTagInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders with no initial bibs', () => {
    expect(component.bibs()).toEqual([]);
  });

  it('pre-populates bibs from initialBibs input', () => {
    component.initialBibs = ['101', '202'];
    component.ngOnChanges({ initialBibs: {} as never });
    expect(component.bibs()).toEqual(['101', '202']);
  });

  it('rejects duplicate bib', () => {
    component.bibs.set(['101']);
    const emitted: string[][] = [];
    component.bibsChanged.subscribe((v) => emitted.push(v));

    const mockEvent = { value: '101', chipInput: { clear: () => {} } } as never;
    component.addBib(mockEvent);

    expect(component.validationError()).toBe('Bib 101 is already added.');
    expect(emitted).toHaveSize(0);
  });

  it('rejects non-numeric bib', () => {
    const mockEvent = { value: 'abc', chipInput: { clear: () => {} } } as never;
    component.addBib(mockEvent);
    expect(component.validationError()).toBe('Bib numbers must contain digits only.');
  });

  it('rejects bib longer than 10 characters', () => {
    const mockEvent = { value: '12345678901', chipInput: { clear: () => {} } } as never;
    component.addBib(mockEvent);
    expect(component.validationError()).toBe('Bib number is too long.');
  });

  it('silently ignores empty input', () => {
    const emitted: string[][] = [];
    component.bibsChanged.subscribe((v) => emitted.push(v));
    const mockEvent = { value: '  ', chipInput: { clear: () => {} } } as never;
    component.addBib(mockEvent);
    expect(component.validationError()).toBeNull();
    expect(emitted).toHaveSize(0);
  });

  it('adds valid bib and emits', () => {
    const emitted: string[][] = [];
    component.bibsChanged.subscribe((v) => emitted.push(v));
    const mockEvent = { value: '303', chipInput: { clear: () => {} } } as never;
    component.addBib(mockEvent);
    expect(component.bibs()).toEqual(['303']);
    expect(emitted).toEqual([['303']]);
  });

  it('removes a bib and emits', () => {
    component.bibs.set(['101', '202']);
    const emitted: string[][] = [];
    component.bibsChanged.subscribe((v) => emitted.push(v));
    component.removeBib('101');
    expect(component.bibs()).toEqual(['202']);
    expect(emitted).toEqual([['202']]);
  });

  it('clears validation error on input change', () => {
    component.validationError.set('some error');
    component.onInputChange();
    expect(component.validationError()).toBeNull();
  });
});
