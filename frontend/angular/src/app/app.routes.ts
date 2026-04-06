import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'photographer',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/photographer/layout/photographer-layout.component').then(
        (m) => m.PhotographerLayoutComponent,
      ),
    children: [
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/photographer/profile/profile.component').then(
            (m) => m.ProfileComponent,
          ),
      },
      {
        path: 'events',
        loadComponent: () =>
          import('./features/photographer/events-placeholder/events-placeholder.component').then(
            (m) => m.EventsPlaceholderComponent,
          ),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/photographer/events-placeholder/events-placeholder.component').then(
            (m) => m.EventsPlaceholderComponent,
          ),
      },
      {
        path: '',
        redirectTo: 'events',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full',
  },
];
