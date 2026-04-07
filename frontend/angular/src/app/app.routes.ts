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
          import('./features/photographer/events/event-list/event-list.component').then(
            (m) => m.EventListComponent,
          ),
      },
      {
        path: 'events/new',
        loadComponent: () =>
          import('./features/photographer/events/event-create/event-create.component').then(
            (m) => m.EventCreateComponent,
          ),
      },
      {
        path: 'events/:id/edit',
        loadComponent: () =>
          import('./features/photographer/events/event-edit/event-edit.component').then(
            (m) => m.EventEditComponent,
          ),
      },
      {
        path: 'events/:id',
        loadComponent: () =>
          import('./features/photographer/events/event-detail/event-detail.component').then(
            (m) => m.EventDetailComponent,
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
