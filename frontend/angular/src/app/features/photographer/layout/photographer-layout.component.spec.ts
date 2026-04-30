import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PhotographerLayoutComponent } from './photographer-layout.component';
import { initialAuthState } from '../../../store/auth/auth.state';
import { AuthActions } from '../../../store/auth/auth.actions';

describe('PhotographerLayoutComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhotographerLayoutComponent, RouterTestingModule, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          initialState: {
            auth: { ...initialAuthState, status: 'authenticated', email: 'test@example.com' },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(PhotographerLayoutComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch signOut action when sign out is clicked', () => {
    const fixture = TestBed.createComponent(PhotographerLayoutComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    const dispatchSpy = spyOn(store, 'dispatch');
    comp.signOut();

    expect(dispatchSpy).toHaveBeenCalledWith(AuthActions.signOut());
    expect(comp.signingOut()).toBeTrue();
  });
});
