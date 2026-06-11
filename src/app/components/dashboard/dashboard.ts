import { Component, inject, OnInit, ViewChild, DestroyRef, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signOut, user, User } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ThreeCanvas } from '../three-canvas/three-canvas';
import { StorageService, TrailerPreset, CargoPreset } from '../../services/storage.service';
import { I18nService } from '../../services/i18n.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, ThreeCanvas],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  @ViewChild(ThreeCanvas) canvasRef!: ThreeCanvas;

  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly storageService = inject(StorageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly i18n = inject(I18nService);
  readonly themeService = inject(ThemeService);

  readonly currentUser$: Observable<User | null> = user(this.auth);
  userEmail = '';
  userId = '';

  /** Active view mode */
  activeMode: '2d' | '3d' = '3d';

  /** Pop-down selector states */
  showTrailersDropdown = false;
  showCargoDropdown = false;

  /** Modal & Mobile Sidebar states */
  showAddTrailerModal = false;
  showAddCargoModal = false;
  showAutoLoadModal = false;
  showSidebarMobile = false;

  /** Active trailer */
  activeTrailer: TrailerPreset = {
    id: 'default',
    name: '',
    length: 12.0,
    width: 2.5,
    height: 2.7,
  };

  /** Selection state */
  selectedPalletId: string | null = null;
  edgeRotatePos: { x: number; y: number } | null = null;

  /** Collections from Firestore */
  trailers: TrailerPreset[] = [];
  cargoTypes: CargoPreset[] = [];

  /** Form models — Trailer */
  trailerName = '';
  newTrailerL = 12.0;
  newTrailerW = 2.5;
  newTrailerH = 2.7;

  /** Form models — Cargo */
  cargoName = '';
  newCargoL = 1.2;
  newCargoW = 1.0;
  newCargoH = 1.6;
  newCargoColor = '#3b82f6';
  cargoStackable = false;

  /** Auto Optimize */
  autoOptimizeAll = false;

  /** Live Editor State */
  liveTrailerL = 12.0;
  liveTrailerW = 2.5;
  liveTrailerH = 2.7;

  customPalletL = 1.2;
  customPalletW = 1.0;
  customPalletH = 1.6;
  customPalletColor = '#ff0000';
  customPalletStackable = false;

  /** Auto-loadout */
  autoLoadItems: { preset: CargoPreset; quantity: number }[] = [];
  autoLoadResult: { placed: number; total: number } | null = null;

  /** Toast notifications */
  toasts: { id: number; message: string; type: 'error' | 'success' | 'warning'; removing?: boolean }[] = [];
  private toastCounter = 0;

  ngOnInit(): void {
    this.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((u) => {
        if (u) {
          this.userEmail = u.email || this.i18n.t('dashboard.logisticsDriver');
          this.userId = u.uid;
          this.subscribeToFirestore(u.uid);
        } else {
          this.userEmail = this.i18n.t('dashboard.logisticsDriver');
          this.userId = '';
          this.trailers = [];
          this.cargoTypes = [];
        }
        this.cdr.detectChanges();
      });
  }

  private subscribeToFirestore(uid: string): void {
    this.storageService.getTrailers(uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => { 
          this.trailers = data; 
          this.cdr.detectChanges();
        },
        error: (err) => { console.error('[Firestore] Trailers error:', err); },
      });

    this.storageService.getCargoTypes(uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => { 
          this.cargoTypes = data; 
          this.cdr.detectChanges();
        },
        error: (err) => { console.error('[Firestore] Cargo error:', err); },
      });
  }

  async logout(): Promise<void> {
    try {
      await signOut(this.auth);
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  // ─── Toggle Selectors ────────────────────────────────────

  toggleTrailersDropdown(): void {
    this.showTrailersDropdown = !this.showTrailersDropdown;
    this.showCargoDropdown = false;
  }

  toggleCargoDropdown(): void {
    this.showCargoDropdown = !this.showCargoDropdown;
    this.showTrailersDropdown = false;
  }

  toggleActiveMode(): void {
    this.activeMode = this.activeMode === '2d' ? '3d' : '2d';
  }

  // ─── Scrolling ───────────────────────────────────────────

  onHorizontalScroll(event: WheelEvent): void {
    if (event.deltaY !== 0) {
      const target = event.currentTarget as HTMLElement;
      target.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }

  // ─── Trailer Selection ───────────────────────────────────

  selectTrailer(t: TrailerPreset): void {
    this.activeTrailer = { ...t };
    this.liveTrailerL = t.length;
    this.liveTrailerW = t.width;
    this.liveTrailerH = t.height;
  }

  selectDefaultTrailer(): void {
    this.activeTrailer = {
      id: 'default',
      name: this.i18n.t('dashboard.defaultTrailer'),
      length: 12.0,
      width: 2.5,
      height: 2.7,
    };
    this.liveTrailerL = 12.0;
    this.liveTrailerW = 2.5;
    this.liveTrailerH = 2.7;
  }

  // ─── Pallet Spawning ─────────────────────────────────────

  spawnFromPreset(c: CargoPreset): void {
    if (this.canvasRef) {
      this.canvasRef.spawnPalletFromPreset(c);
    }
  }

  // ─── Canvas Event Handlers ───────────────────────────────

  onPalletSelected(id: string | null): void {
    this.selectedPalletId = id;
    if (!id) {
      this.edgeRotatePos = null;
    } else {
      if (this.canvasRef) {
        // Dimensions update for live editing removed
      }
    }
  }

  onEdgeHoverRotate(pos: { x: number; y: number } | null): void {
    this.edgeRotatePos = pos;
  }

  onSpawnBlocked(name: string): void {
    this.showToast(this.i18n.t('toast.spawnBlocked', { name }), 'warning');
  }

  // ─── Live Editing Handlers ───────────────────────────────

  onLiveTrailerEdit(): void {
    if (this.canvasRef) {
      this.canvasRef.applyTrailerDimensions(this.liveTrailerL, this.liveTrailerW, this.liveTrailerH);
      this.activeTrailer.length = this.liveTrailerL;
      this.activeTrailer.width = this.liveTrailerW;
      this.activeTrailer.height = this.liveTrailerH;
    }
  }

  spawnCustomPallet(): void {
    if (!this.canvasRef) return;
    const l = Number(this.customPalletL);
    const w = Number(this.customPalletW);
    const h = Number(this.customPalletH);

    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) {
      this.showToast(this.i18n.t('toast.invalidCargoDimensions'), 'error');
      return;
    }

    const customPreset: CargoPreset = {
      id: `custom-${crypto.randomUUID().substring(0, 8)}`,
      name: this.i18n.t('editor.customPalletTitle'),
      length: l,
      width: w,
      height: h,
      color: this.customPalletColor,
      stackable: this.customPalletStackable,
    };
    
    this.canvasRef.spawnPalletFromPreset(customPreset);
  }

  // ─── Selected Pallet Actions ─────────────────────────────

  rotateSelectedPallet(): void {
    this.canvasRef?.rotateSelected();
  }

  deleteSelectedPallet(): void {
    if (this.canvasRef) {
      this.canvasRef.deleteSelected();
      this.selectedPalletId = null;
      this.edgeRotatePos = null;
    }
  }

  clearAllPallets(): void {
    if (this.canvasRef) {
      this.canvasRef.resetLoad();
      this.selectedPalletId = null;
      this.edgeRotatePos = null;
    }
  }

  edgeRotate(): void {
    this.canvasRef?.rotateSelected();
  }

  // ─── Modals ──────────────────────────────────────────────

  private closeAllOverlays(): void {
    this.showTrailersDropdown = false;
    this.showCargoDropdown = false;
    this.showAddTrailerModal = false;
    this.showAddCargoModal = false;
    this.showAutoLoadModal = false;
    this.showSidebarMobile = false;
  }

  toggleSidebarMobile(): void {
    this.showSidebarMobile = !this.showSidebarMobile;
  }

  openAddTrailerModal(): void {
    this.closeAllOverlays();
    this.resetTrailerForm();
    this.showAddTrailerModal = true;
  }

  closeAddTrailerModal(): void {
    this.showAddTrailerModal = false;
    this.resetTrailerForm();
  }

  openAddCargoModal(): void {
    this.closeAllOverlays();
    this.resetCargoForm();
    this.showAddCargoModal = true;
  }

  closeAddCargoModal(): void {
    this.showAddCargoModal = false;
    this.resetCargoForm();
  }

  // ─── Auto-Loadout Modal ───────────────────────────────────

  openAutoLoadModal(): void {
    this.closeAllOverlays();
    this.autoLoadItems = this.cargoTypes.map(c => ({ preset: c, quantity: 0 }));
    this.autoLoadResult = null;
    this.showAutoLoadModal = true;
  }

  closeAutoLoadModal(): void {
    this.showAutoLoadModal = false;
    this.autoLoadResult = null;
  }

  incrementQty(item: { preset: CargoPreset; quantity: number }): void {
    item.quantity++;
  }

  decrementQty(item: { preset: CargoPreset; quantity: number }): void {
    if (item.quantity > 0) item.quantity--;
  }

  getTotalAutoLoadQty(): number {
    return this.autoLoadItems.reduce((sum, i) => sum + i.quantity, 0);
  }

  executeAutoLoad(): void {
    if (!this.canvasRef) return;
    const items = this.autoLoadItems.filter(i => i.quantity > 0);
    if (items.length === 0) return;

    this.autoLoadResult = this.canvasRef.autoLoadPallets(items);
    this.selectedPalletId = null;
    this.edgeRotatePos = null;
  }

  /** Get localized auto-load result text */
  getAutoLoadResultText(): string {
    if (!this.autoLoadResult) return '';
    const { placed, total } = this.autoLoadResult;
    if (placed === total) {
      return this.i18n.t('dashboard.modal.allPlaced', { placed });
    }
    return this.i18n.t('dashboard.modal.partialPlaced', {
      placed,
      total,
      remaining: total - placed,
    });
  }

  private resetTrailerForm(): void {
    this.trailerName = '';
    this.newTrailerL = 12.0;
    this.newTrailerW = 2.5;
    this.newTrailerH = 2.7;
  }

  private resetCargoForm(): void {
    this.cargoName = '';
    this.newCargoL = 1.2;
    this.newCargoW = 1.0;
    this.newCargoH = 1.6;
    this.newCargoColor = '#3b82f6';
    this.cargoStackable = false;
  }

  // ─── Trailer CRUD ────────────────────────────────────────

  async addTrailer(): Promise<void> {
    if (!this.trailerName.trim()) {
      this.showToast(this.i18n.t('toast.trailerNameRequired'), 'error');
      return;
    }

    const l = Number(this.newTrailerL);
    const w = Number(this.newTrailerW);
    const h = Number(this.newTrailerH);

    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0 || !isFinite(l) || !isFinite(w) || !isFinite(h)) {
      this.showToast(this.i18n.t('toast.invalidTrailerDimensions'), 'error');
      return;
    }

    if (l > 25 || w > 5 || h > 5) {
      this.showToast(this.i18n.t('toast.trailerDimensionsTooLarge'), 'error');
      return;
    }

    const newPreset: TrailerPreset = {
      id: this.generateId('t'),
      name: this.trailerName,
      length: l,
      width: w,
      height: h,
    };

    this.closeAllOverlays();

    try {
      if (this.userId) {
        await this.storageService.saveTrailer(this.userId, newPreset);
      } else {
        this.trailers.push(newPreset);
      }
    } catch (error) {
      console.error('Failed to save trailer:', error);
      this.trailers.push(newPreset);
    }
  }

  async removeTrailer(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.userId) return;
    try {
      await this.storageService.deleteTrailer(this.userId, id);
      if (this.activeTrailer.id === id) {
        this.selectDefaultTrailer();
      }
    } catch (error) {
      console.error('Delete trailer error:', error);
    }
  }

  // ─── Cargo CRUD ──────────────────────────────────────────

  async addCargo(): Promise<void> {
    if (!this.cargoName.trim()) {
      this.showToast(this.i18n.t('toast.cargoNameRequired'), 'error');
      return;
    }

    const l = Number(this.newCargoL);
    const w = Number(this.newCargoW);
    const h = Number(this.newCargoH);

    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0 || !isFinite(l) || !isFinite(w) || !isFinite(h)) {
      this.showToast(this.i18n.t('toast.invalidCargoDimensions'), 'error');
      return;
    }

    if (l > 10 || w > 10 || h > 10) {
      this.showToast(this.i18n.t('toast.cargoDimensionsTooLarge'), 'error');
      return;
    }

    const newPreset: CargoPreset = {
      id: this.generateId('c'),
      name: this.cargoName,
      length: l,
      width: w,
      height: h,
      color: this.newCargoColor,
      stackable: this.cargoStackable,
    };

    this.closeAllOverlays();

    try {
      if (this.userId) {
        await this.storageService.saveCargoType(this.userId, newPreset);
      } else {
        this.cargoTypes.push(newPreset);
      }
    } catch (error) {
      console.error('Failed to save cargo:', error);
      this.cargoTypes.push(newPreset);
    }
  }

  async removeCargo(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.userId) return;
    try {
      await this.storageService.deleteCargoType(this.userId, id);
    } catch (error) {
      console.error('Delete cargo error:', error);
    }
  }

  // ─── Toast Notifications ─────────────────────────────────

  showToast(message: string, type: 'error' | 'success' | 'warning' = 'error'): void {
    const id = ++this.toastCounter;
    this.toasts.push({ id, message, type });
    setTimeout(() => this.dismissToast(id), 3500);
  }

  dismissToast(id: number): void {
    const toast = this.toasts.find(t => t.id === id);
    if (toast) {
      toast.removing = true;
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, 250);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private generateId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().substring(0, 8)}`;
  }
}
