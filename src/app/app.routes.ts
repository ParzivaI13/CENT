import { Routes } from '@angular/router';
import { Login } from './components/login/login';
import { Dashboard } from './components/dashboard/dashboard';
import { redirectUnauthorizedTo, redirectLoggedInTo, AuthGuard } from '@angular/fire/auth-guard';

const redirectUnauthorizedToLogin = () => redirectUnauthorizedTo(['login']);
const redirectLoggedInToDashboard = () => redirectLoggedInTo(['dashboard']);

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { 
    path: 'login', 
    component: Login, 
    canActivate: [AuthGuard], 
    data: { authGuardPipe: redirectLoggedInToDashboard } 
  },
  { 
    path: 'dashboard', 
    component: Dashboard, 
    canActivate: [AuthGuard], 
    data: { authGuardPipe: redirectUnauthorizedToLogin } 
  },
  { path: '**', redirectTo: 'dashboard' }
];

