import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '@angular/fire/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);

  email = '';
  password = '';
  isRegistering = false;
  isLoading = false;
  errorMessage = '';

  async onSubmit() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter email and password.';
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



  toggleMode() {
    this.isRegistering = !this.isRegistering;
    this.errorMessage = '';
  }

  private getFriendlyErrorMessage(code: string): string {
    switch (code) {
      case 'auth/invalid-email':
        return 'The email address is invalid.';
      case 'auth/user-disabled':
        return 'This user account has been disabled.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Invalid email or password.';
      case 'auth/email-already-in-use':
        return 'This email is already registered.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }
}
