import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { ProfileComponent } from './profile.component';
import { initialPhotographerState } from '../../../store/photographer/photographer.state';
import { PhotographerActions } from '../../../store/photographer/photographer.actions';

describe('ProfileComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ProfileComponent,
        ReactiveFormsModule,
        RouterTestingModule,
        NoopAnimationsModule,
        MatSnackBarModule,
      ],
      providers: [provideMockStore({ initialState: { photographer: initialPhotographerState } })],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch loadProfile on init', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();

    expect(dispatchSpy).toHaveBeenCalledWith(PhotographerActions.loadProfile());
  });

  it('should dispatch updateProfile on valid form submit', () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.setValue({
      displayName: 'John Doe',
      defaultCurrency: 'USD',
      bankName: 'Test Bank',
      bankAccountHolder: 'John Doe',
      bankAccountNumber: '12345678',
      bankInstructions: 'Reference: race2025',
    });

    const dispatchSpy = spyOn(store, 'dispatch');
    comp.onSave();

    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotographerActions.updateProfile({
        profile: {
          displayName: 'John Doe',
          defaultCurrency: 'USD',
          bankName: 'Test Bank',
          bankAccountHolder: 'John Doe',
          bankAccountNumber: '12345678',
          bankInstructions: 'Reference: race2025',
        },
      }),
    );
  });

  it('should not dispatch on invalid form (missing required displayName)', () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.setValue({
      displayName: '',
      defaultCurrency: 'USD',
      bankName: '',
      bankAccountHolder: '',
      bankAccountNumber: '',
      bankInstructions: '',
    });

    const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    // Reset to exclude the loadProfile dispatch from ngOnInit
    dispatchSpy.calls.reset();
    comp.onSave();

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: PhotographerActions.updateProfile.type }),
    );
  });

  it('should have all supported currencies in the currencies list', () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    const comp = fixture.componentInstance;
    const codes = comp.currencies.map((c) => c.code);
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
    expect(codes).toContain('GTQ');
  });
});
