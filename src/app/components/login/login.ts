import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '@angular/fire/auth';
import { I18nService } from '../../services/i18n.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly i18n = inject(I18nService);
  readonly themeService = inject(ThemeService);

  email = '';
  password = '';
  isRegistering = false;
  isLoading = false;
  errorMessage = '';

  async onSubmit(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage = this.i18n.t('login.enterEmailAndPassword');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      if (this.isRegistering) {
        await createUserWithEmailAndPassword(this.auth, this.email, this.password);
      } else {
        await signInWithEmailAndPassword(this.auth, this.email, this.password);
      }
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      this.errorMessage = this.getFriendlyErrorMessage(error.code);
    } finally {
      this.isLoading = false;
    }
  }

  toggleMode(): void {
    this.isRegistering = !this.isRegistering;
    this.errorMessage = '';
  }

  private getFriendlyErrorMessage(code: string): string {
    const errorMap: Record<string, string> = {
      'auth/invalid-email': 'login.error.invalidEmail',
      'auth/user-disabled': 'login.error.userDisabled',
      'auth/user-not-found': 'login.error.invalidCredential',
      'auth/wrong-password': 'login.error.invalidCredential',
      'auth/invalid-credential': 'login.error.invalidCredential',
      'auth/email-already-in-use': 'login.error.emailInUse',
      'auth/weak-password': 'login.error.weakPassword',
    };

    const key = errorMap[code] ?? 'login.error.generic';
    return this.i18n.t(key);
  }
}
