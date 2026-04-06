import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { LoginComponent } from './login.component';
import { initialAuthState } from '../../../store/auth/auth.state';
import { AuthActions } from '../../../store/auth/auth.actions';

describe('LoginComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        LoginComponent,
        ReactiveFormsModule,
        RouterTestingModule,
        NoopAnimationsModule,
        MatSnackBarModule,
      ],
      providers: [provideMockStore({ initialState: { auth: initialAuthState } })],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch signIn action on valid submit', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.setValue({ email: 'test@example.com', password: 'password123' });

    const dispatchSpy = spyOn(store, 'dispatch');
    comp.onSubmit();

    expect(dispatchSpy).toHaveBeenCalledWith(
      AuthActions.signIn({ username: 'test@example.com', password: 'password123' }),
    );
  });

  it('should not dispatch on invalid form', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.setValue({ email: '', password: '' });
    const dispatchSpy = spyOn(store, 'dispatch');
    comp.onSubmit();

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('should toggle password visibility', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.showPassword()).toBeFalse();
    comp.togglePasswordVisibility();
    expect(comp.showPassword()).toBeTrue();
  });
});
