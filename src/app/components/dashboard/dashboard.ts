import { Component, inject, OnInit, OnDestroy, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signOut, user, User } from '@angular/fire/auth';
import { Observable, Subscription } from 'rxjs';
import { ThreeCanvas } from '../three-canvas/three-canvas';
import { StorageService, TrailerPreset, CargoPreset } from '../../services/storage.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ThreeCanvas],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  @ViewChild(ThreeCanvas) canvasRef!: ThreeCanvas;

  private auth = inject(Auth);
  private router = inject(Router);
  private storageService = inject(StorageService);
  private cdr = inject(ChangeDetectorRef);

  currentUser$: Observable<User | null> = user(this.auth);
  userEmail = 'Logistics Driver';
  userId = '';

  // Active Loading mode
  activeMode: '2d' | '3d' = '3d';

  // Pop-Down Selectors States
  showTrailersDropdown = false;
  showCargoDropdown = false;

  // Centered Popup Modals States
  showAddTrailerModal = false;
  showAddCargoModal = false;

  // Active trailer
  activeTrailer: TrailerPreset = {
    id: 'default',
    name: 'Default Trailer',
    length: 12.0,
    width: 2.5,
    height: 2.7,
  };

  // Selection state (from canvas events)
  selectedPalletId: string | null = null;

  // Edge-hover rotate button position
  edgeRotatePos: { x: number; y: number } | null = null;

  // Real-time collections
  trailers: TrailerPreset[] = [];
  cargoTypes: CargoPreset[] = [];

  // Form Models - Trailer
  trailerName = '';
  newTrailerL = 12.0;
  newTrailerW = 2.5;
  newTrailerH = 2.7;

  // Form Models - Cargo
  cargoName = '';
  newCargoL = 1.2;
  newCargoW = 1.0;
  newCargoH = 1.6;
  newCargoColor = '#3b82f6';
  cargoStackable = false;

  // Auto-Loadout
  showAutoLoadModal = false;
  autoLoadItems: { preset: CargoPreset; quantity: number }[] = [];
  autoLoadResult: { placed: number; total: number } | null = null;

  private authSub!: Subscription;
  private trailerSub!: Subscription;
  private cargoSub!: Subscription;

  ngOnInit() {
    console.log('ВЕРСІЯ КОДУ: 3.0 - ANGULAR FIRE FIRESTORE FIX');
    this.authSub = this.currentUser$.subscribe((u) => {
      console.log('[Dashboard] Auth state changed. User:', u ? u.uid : 'null');
      if (u) {
        this.userEmail = u.email || 'Logistics Driver';
        this.userId = u.uid;

        // Unsubscribe from previous Firestore listeners before re-subscribing
        if (this.trailerSub) this.trailerSub.unsubscribe();
        this.trailerSub = this.storageService.getTrailers(u.uid).subscribe({
          next: (data) => {
            console.log('Firebase data fetched (trailers in dashboard):', data);
            this.trailers = data;
            this.cdr.detectChanges();
          },
          error: (err) => {
            console.error('[Dashboard] Firestore trailers subscription error:', err);
          }
        });

        if (this.cargoSub) this.cargoSub.unsubscribe();
        this.cargoSub = this.storageService.getCargoTypes(u.uid).subscribe({
          next: (data) => {
            console.log('Firebase data fetched (cargo in dashboard):', data);
            this.cargoTypes = data;
            this.cdr.detectChanges();
          },
          error: (err) => {
            console.error('[Dashboard] Firestore cargo subscription error:', err);
          }
        });
      } else {
        console.log('[Dashboard] No authenticated user. Clearing data.');
        this.userEmail = 'Logistics Driver';
        this.userId = '';
        this.trailers = [];
        this.cargoTypes = [];
      }
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.authSub) this.authSub.unsubscribe();
    if (this.trailerSub) this.trailerSub.unsubscribe();
    if (this.cargoSub) this.cargoSub.unsubscribe();
  }

  async logout() {
    try {
      await signOut(this.auth);
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  // ─── Toggle Selectors ────────────────────────────────────

  toggleTrailersDropdown() {
    console.log('[DEBUG] toggleTrailersDropdown called. Previous showTrailersDropdown:', this.showTrailersDropdown);
    this.showTrailersDropdown = !this.showTrailersDropdown;
    this.showCargoDropdown = false;
    console.log('[DEBUG] toggleTrailersDropdown completed. New showTrailersDropdown:', this.showTrailersDropdown, 'showCargoDropdown:', this.showCargoDropdown);
  }

  toggleCargoDropdown() {
    console.log('[DEBUG] toggleCargoDropdown called. Previous showCargoDropdown:', this.showCargoDropdown);
    this.showCargoDropdown = !this.showCargoDropdown;
    this.showTrailersDropdown = false;
    console.log('[DEBUG] toggleCargoDropdown completed. New showCargoDropdown:', this.showCargoDropdown, 'showTrailersDropdown:', this.showTrailersDropdown);
  }

  toggleActiveMode() {
    console.log('[DEBUG] toggleActiveMode called. Previous activeMode:', this.activeMode);
    this.activeMode = this.activeMode === '2d' ? '3d' : '2d';
    console.log('[DEBUG] toggleActiveMode completed. New activeMode:', this.activeMode);
  }

  // ─── Trailer Selection ───────────────────────────────────

  selectTrailer(t: TrailerPreset) {
    console.log('[DEBUG] selectTrailer called. Selected trailer:', t);
    this.activeTrailer = t;
  }

  selectDefaultTrailer() {
    console.log('[DEBUG] selectDefaultTrailer called.');
    this.activeTrailer = {
      id: 'default',
      name: 'Default Trailer',
      length: 12.0,
      width: 2.5,
      height: 2.7,
    };
  }

  // ─── Pallet Spawning ─────────────────────────────────────

  spawnFromPreset(c: CargoPreset) {
    console.log('[DEBUG] spawnFromPreset called with preset:', c);
    if (this.canvasRef) {
      console.log('[DEBUG] Spawning pallet in Three.js viewport');
      this.canvasRef.spawnPalletFromPreset(c);
    } else {
      console.warn('[DEBUG] Cannot spawn: canvasRef is null');
    }
  }

  // ─── Canvas Event Handlers ───────────────────────────────

  onPalletSelected(id: string | null) {
    this.selectedPalletId = id;
    if (!id) {
      this.edgeRotatePos = null;
    }
  }

  onEdgeHoverRotate(pos: { x: number; y: number } | null) {
    this.edgeRotatePos = pos;
  }

  // ─── Selected Pallet Actions ─────────────────────────────

  rotateSelectedPallet() {
    if (this.canvasRef) {
      this.canvasRef.rotateSelected();
    }
  }

  deleteSelectedPallet() {
    if (this.canvasRef) {
      this.canvasRef.deleteSelected();
      this.selectedPalletId = null;
      this.edgeRotatePos = null;
    }
  }

  clearAllPallets() {
    if (this.canvasRef) {
      this.canvasRef.resetLoad();
      this.selectedPalletId = null;
      this.edgeRotatePos = null;
    }
  }

  edgeRotate() {
    if (this.canvasRef) {
      this.canvasRef.rotateSelected();
    }
  }

  // ─── Modals ──────────────────────────────────────────────

  private closeAllOverlays() {
    console.log('[DEBUG] closeAllOverlays called. Setting all overlays and dropdown states to false.');
    this.showTrailersDropdown = false;
    this.showCargoDropdown = false;
    this.showAddTrailerModal = false;
    this.showAddCargoModal = false;
    this.showAutoLoadModal = false;
  }

  openAddTrailerModal() {
    console.log('[DEBUG] openAddTrailerModal called.');
    this.closeAllOverlays();
    this.resetTrailerForm();
    this.showAddTrailerModal = true;
    console.log('[DEBUG] showAddTrailerModal set to true. showAddCargoModal:', this.showAddCargoModal);
  }

  closeAddTrailerModal() {
    console.log('[DEBUG] closeAddTrailerModal called.');
    this.showAddTrailerModal = false;
    this.resetTrailerForm();
  }

  openAddCargoModal() {
    console.log('[DEBUG] openAddCargoModal called.');
    this.closeAllOverlays();
    this.resetCargoForm();
    this.showAddCargoModal = true;
    console.log('[DEBUG] showAddCargoModal set to true. showAddTrailerModal:', this.showAddTrailerModal);
  }

  closeAddCargoModal() {
    console.log('[DEBUG] closeAddCargoModal called.');
    this.showAddCargoModal = false;
    this.resetCargoForm();
  }

  // ─── Auto-Loadout Modal ───────────────────────────────────

  openAutoLoadModal() {
    this.closeAllOverlays();
    this.autoLoadItems = this.cargoTypes.map(c => ({ preset: c, quantity: 0 }));
    this.autoLoadResult = null;
    this.showAutoLoadModal = true;
  }

  closeAutoLoadModal() {
    this.showAutoLoadModal = false;
    this.autoLoadResult = null;
  }

  incrementQty(item: { preset: CargoPreset; quantity: number }) {
    item.quantity++;
  }

  decrementQty(item: { preset: CargoPreset; quantity: number }) {
    if (item.quantity > 0) item.quantity--;
  }

  getTotalAutoLoadQty(): number {
    return this.autoLoadItems.reduce((sum, i) => sum + i.quantity, 0);
  }

  executeAutoLoad() {
    if (!this.canvasRef) return;
    const items = this.autoLoadItems.filter(i => i.quantity > 0);
    if (items.length === 0) return;

    this.autoLoadResult = this.canvasRef.autoLoadPallets(items);
    this.selectedPalletId = null;
    this.edgeRotatePos = null;
    this.cdr.detectChanges();
  }

  private resetTrailerForm() {
    this.trailerName = '';
    this.newTrailerL = 12.0;
    this.newTrailerW = 2.5;
    this.newTrailerH = 2.7;
  }

  private resetCargoForm() {
    this.cargoName = '';
    this.newCargoL = 1.2;
    this.newCargoW = 1.0;
    this.newCargoH = 1.6;
    this.newCargoColor = '#3b82f6';
    this.cargoStackable = false;
  }

  // ─── Trailer CRUD ────────────────────────────────────────

  async addTrailer() {
    console.log('[DEBUG] addTrailer form submitted. trailerName:', this.trailerName, 'Dimensions:', this.newTrailerL, 'x', this.newTrailerW, 'x', this.newTrailerH);
    if (!this.trailerName.trim()) {
      alert('Please provide a name for this trailer.');
      return;
    }

    const newPreset: TrailerPreset = {
      id: 't-' + Math.random().toString(36).substring(2, 9),
      name: this.trailerName,
      length: Number(this.newTrailerL),
      width: Number(this.newTrailerW),
      height: Number(this.newTrailerH)
    };

    console.log('[DEBUG] Generated trailer preset object:', newPreset);

    // Close everything and reset form
    this.closeAllOverlays();

    try {
      if (this.userId) {
        console.log('[DEBUG] Saving trailer to Firestore for user:', this.userId);
        await this.storageService.saveTrailer(this.userId, newPreset);
        console.log('[FIREBASE SUCCESS] Trailer saved successfully to Firebase:', newPreset);
      } else {
        console.log('[DEBUG] No authenticated user. Saving trailer locally.');
        this.trailers.push(newPreset);
      }
    } catch (error) {
      console.error('[FIREBASE ERROR] Failed to save trailer to Firebase:', error);
      this.trailers.push(newPreset); // Fallback if Firestore fails
    }
  }

  async removeTrailer(id: string, event: Event) {
    event.stopPropagation();
    if (!this.userId) return;
    try {
      await this.storageService.deleteTrailer(this.userId, id);
      // If deleted trailer was active, revert to default
      if (this.activeTrailer.id === id) {
        this.selectDefaultTrailer();
      }
    } catch (error) {
      console.error('Delete trailer error:', error);
    }
  }

  // ─── Cargo CRUD ──────────────────────────────────────────

  async addCargo() {
    console.log('[DEBUG] addCargo form submitted. cargoName:', this.cargoName, 'Dimensions:', this.newCargoL, 'x', this.newCargoW, 'x', this.newCargoH, 'Color:', this.newCargoColor, 'Stackable:', this.cargoStackable);
    if (!this.cargoName.trim()) {
      alert('Please provide a name for this cargo type.');
      return;
    }

    const newPreset: CargoPreset = {
      id: 'c-' + Math.random().toString(36).substring(2, 9),
      name: this.cargoName,
      length: Number(this.newCargoL),
      width: Number(this.newCargoW),
      height: Number(this.newCargoH),
      color: this.newCargoColor,
      stackable: this.cargoStackable
    };

    console.log('[DEBUG] Generated cargo preset object:', newPreset);

    // Close everything and reset form
    this.closeAllOverlays();

    try {
      if (this.userId) {
        console.log('[DEBUG] Saving cargo preset to Firestore for user:', this.userId);
        await this.storageService.saveCargoType(this.userId, newPreset);
        console.log('[FIREBASE SUCCESS] Cargo preset saved successfully to Firebase:', newPreset);
      } else {
        console.log('[DEBUG] No authenticated user. Saving cargo locally.');
        this.cargoTypes.push(newPreset);
      }
    } catch (error) {
      console.error('[FIREBASE ERROR] Failed to save cargo preset to Firebase:', error);
      this.cargoTypes.push(newPreset); // Fallback if Firestore fails
    }
  }

  async removeCargo(id: string, event: Event) {
    event.stopPropagation();
    if (!this.userId) return;
    try {
      await this.storageService.deleteCargoType(this.userId, id);
    } catch (error) {
      console.error('Delete cargo error:', error);
    }
  }
}
