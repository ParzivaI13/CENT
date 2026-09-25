import { Component, inject, OnInit, ViewChild, DestroyRef, ChangeDetectorRef, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signOut, user, User } from '@angular/fire/auth';
import { Observable, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ThreeCanvas } from '../three-canvas/three-canvas';
import { PalletListItem } from '../three-canvas/three-canvas';
import { StorageService, TrailerPreset, CargoPreset, LayoutSnapshot } from '../../services/storage.service';
import { ExportService } from '../../services/export.service';
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
  private readonly exportService = inject(ExportService);
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
  showHistoryModal = false;
  showSidebarMobile = false;
  showPalletListMobile = false;

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

  /** Pallet sidebar list */
  palletList: PalletListItem[] = [];

  /** Collections from Firestore */
  trailers: TrailerPreset[] = [];
  cargoTypes: CargoPreset[] = [];
  layoutHistory: LayoutSnapshot[] = [];

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
  cargoStackable = false;

  /** Auto Optimize */
  autoOptimizeAll = false;

  /** Live Editor State */
  liveTrailerL = 12.0;
  liveTrailerW = 2.5;
  liveTrailerH = 2.7;

  customPalletName = '';
  private isCustomPalletNameDirty = false;
  customPalletL = 1.2;
  customPalletW = 1.0;
  customPalletH = 1.6;
  customPalletStackable = false;

  /** Auto-loadout */
  autoLoadItems: { preset: CargoPreset; quantity: number }[] = [];
  autoLoadResult: { placed: number; total: number } | null = null;

  /** Toast notifications */
  toasts: { id: number; message: string; type: 'error' | 'success' | 'warning'; removing?: boolean }[] = [];
  private toastCounter = 0;

  /** Exporting 2D JPG state */
  isExportingJpg = false;

  /** Auto-save layout subject */
  private readonly layoutSave$ = new Subject<LayoutSnapshot>();

  constructor() {
    effect(() => {
      // Reactively keep custom pallet name synced to current language until edited
      this.i18n.lang();
      if (!this.isCustomPalletNameDirty) {
        this.customPalletName = this.i18n.t('editor.customPalletTitle');
      }
    });

    this.layoutSave$.pipe(
      debounceTime(2000),
      takeUntilDestroyed()
    ).subscribe((snapshot) => {
      if (this.userId) {
        this.storageService.saveLayout(this.userId, snapshot).catch(err => {
          console.error('[Firestore] Failed to auto-save layout', err);
        });
      }
    });
  }

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

    this.storageService.getLayouts(uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.layoutHistory = data;
          this.cdr.detectChanges();
        },
        error: (err) => { console.error('[Firestore] Layouts error:', err); }
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

  onLayoutChanged(snapshot: LayoutSnapshot): void {
    this.layoutSave$.next(snapshot);
  }

  onPalletListChanged(list: PalletListItem[]): void {
    this.palletList = list;
  }

  onSidebarPalletClick(id: string): void {
    if (this.canvasRef) {
      this.canvasRef.selectPalletById(id);
    }
  }

  onSidebarPalletDimChange(item: PalletListItem): void {
    if (!this.canvasRef) return;
    const l = Number(item.length);
    const w = Number(item.width);
    const h = Number(item.height);
    if (l > 0 && w > 0 && h > 0) {
      this.canvasRef.updatePalletDimensionsById(item.id, l, w, h);
    }
  }

  onSidebarPalletNameChange(item: PalletListItem): void {
    if (this.canvasRef) {
      this.canvasRef.updatePalletNameById(item.id, item.name);
    }
  }

  onSidebarPalletColorChange(item: PalletListItem): void {
    if (this.canvasRef) {
      this.canvasRef.updatePalletColor(item.id, item.color);
    }
  }

  deleteSidebarPallet(id: string): void {
    if (this.canvasRef) {
      this.canvasRef.deletePalletById(id);
      if (this.selectedPalletId === id) {
        this.selectedPalletId = null;
        this.edgeRotatePos = null;
      }
    }
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

  onCustomPalletNameInput(): void {
    this.isCustomPalletNameDirty = true;
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

    const palletName = this.customPalletName.trim() || this.i18n.t('editor.customPalletTitle');

    const customPreset: CargoPreset = {
      id: `custom-${crypto.randomUUID().substring(0, 8)}`,
      name: palletName,
      length: l,
      width: w,
      height: h,
      color: this.randomHslColor(),
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
    this.showHistoryModal = false;
    this.showSidebarMobile = false;
    this.showPalletListMobile = false;
  }

  toggleSidebarMobile(): void {
    this.showSidebarMobile = !this.showSidebarMobile;
  }

  togglePalletListMobile(): void {
    this.showPalletListMobile = !this.showPalletListMobile;
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

  // ─── History / Layout Restore Modal ──────────────────────

  openHistoryModal(): void {
    this.closeAllOverlays();
    this.showHistoryModal = true;
  }

  closeHistoryModal(): void {
    this.showHistoryModal = false;
  }

  restoreLayout(snapshot: LayoutSnapshot): void {
    if (this.canvasRef) {
      this.canvasRef.loadFromSnapshot(snapshot, false);
      this.closeHistoryModal();
    }
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  // ─── Undo / Redo / Re-optimize ────────────────────────────

  undo(): void {
    this.canvasRef?.undo();
  }

  redo(): void {
    this.canvasRef?.redo();
  }

  reoptimizeScene(): void {
    if (!this.canvasRef) return;
    
    // Gather all current items and quantities
    const itemMap = new Map<string, { preset: CargoPreset; quantity: number }>();
    for (const item of this.palletList) {
      // Re-construct preset from pallet list item
      const preset: CargoPreset = {
        id: item.id,
        name: item.name,
        length: item.length,
        width: item.width,
        height: item.height,
        color: item.color,
        stackable: item.stackable
      };
      
      const key = `${preset.name}-${preset.length}-${preset.width}-${preset.height}`;
      if (!itemMap.has(key)) {
        itemMap.set(key, { preset, quantity: 1 });
      } else {
        itemMap.get(key)!.quantity++;
      }
    }
    
    const items = Array.from(itemMap.values());
    if (items.length > 0) {
      this.canvasRef.autoLoadPallets(items);
      this.selectedPalletId = null;
      this.edgeRotatePos = null;
    }
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
      color: this.randomHslColor(),
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

  // ─── Export & Import ─────────────────────────────────────

  async export2dJpg(): Promise<void> {
    if (!this.canvasRef) return;
    const pallets = this.canvasRef.getPlacedPalletsData();
    if (pallets.length === 0) {
      this.showToast(this.i18n.t('toast.noPalletsToExport'), 'warning');
      return;
    }

    this.isExportingJpg = true;
    try {
      const count = await this.exportService.exportLoadoutToJpg(this.activeTrailer, pallets);
      const msg = this.i18n.t('toast.exportJpgSuccess').replace('{count}', count.toString());
      this.showToast(msg, 'success');
    } catch (error) {
      console.error('Failed to export JPG images:', error);
      this.showToast('Failed to export JPG images', 'error');
    } finally {
      this.isExportingJpg = false;
      this.cdr.markForCheck();
    }
  }

  exportPalletListJson(): void {
    if (!this.canvasRef) return;
    const pallets = this.canvasRef.getPlacedPalletsData();
    if (pallets.length === 0) {
      this.showToast(this.i18n.t('toast.noPalletsToExport'), 'warning');
      return;
    }

    try {
      this.exportService.exportPalletListToJson(this.activeTrailer, pallets);
      this.showToast(this.i18n.t('toast.exportJsonSuccess'), 'success');
    } catch (error) {
      console.error('Failed to export JSON:', error);
      this.showToast('Failed to export JSON file', 'error');
    }
  }

  triggerImportJson(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (event: Event) => {
      this.onJsonFileSelected(event);
    };
    input.click();
  }

  async onJsonFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    try {
      const { trailer, layout, count } = await this.exportService.importPalletListFromJson(file);
      
      if (this.canvasRef) {
        this.canvasRef.suppressNextTrailerReset();
      }

      if (trailer) {
        this.activeTrailer = { ...trailer };
        this.liveTrailerL = trailer.length;
        this.liveTrailerW = trailer.width;
        this.liveTrailerH = trailer.height;
      }

      // Ensure activeTrailer changes propagate to canvas before loading pallets
      this.cdr.detectChanges();

      if (this.canvasRef && layout.pallets.length > 0) {
        // Automatically pack imported pallets in the optimum way
        const items = layout.pallets.map(p => ({
          preset: { ...p.preset },
          quantity: 1,
        }));

        const result = this.canvasRef.autoLoadPallets(items);
        this.selectedPalletId = null;
        this.edgeRotatePos = null;

        if (result.placed < result.total) {
          const warnMsg = this.i18n.t('dashboard.modal.partialPlaced', {
            placed: result.placed,
            total: count,
            remaining: count - result.placed,
          });
          this.showToast(warnMsg, 'warning');
        } else {
          const msg = this.i18n.t('toast.importJsonSuccess', { count: count.toString() });
          this.showToast(msg, 'success');
        }
      }
    } catch (error: any) {
      console.error('Failed to import JSON file:', error);
      const errorMsg = this.i18n.t('toast.importJsonError') + (error?.message ? `: ${error.message}` : '');
      this.showToast(errorMsg, 'error');
    } finally {
      input.value = '';
      this.cdr.markForCheck();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private generateId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().substring(0, 8)}`;
  }

  /** ponytail: random saturated color for visual variety */
  private randomHslColor(): string {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 55%)`;
  }
}
