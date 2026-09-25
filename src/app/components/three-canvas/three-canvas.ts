import {
  Component, ElementRef, OnDestroy, ViewChild, AfterViewInit,
  Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, effect
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CargoPreset, TrailerPreset, LayoutSnapshot, LayoutPalletInfo } from '../../services/storage.service';
import { ThemeService } from '../../services/theme.service';
import { I18nService } from '../../services/i18n.service';

export interface PalletListItem {
  id: string;
  number: number;
  name: string;
  length: number;
  width: number;
  height: number;
  color: string;
  stackable: boolean;
}

interface PalletMeshBundle {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  preset: CargoPreset;
}

@Component({
  selector: 'app-three-canvas',
  imports: [],
  templateUrl: './three-canvas.html',
  styleUrl: './three-canvas.css',
})
export class ThreeCanvas implements OnDestroy, AfterViewInit, OnChanges {
  @ViewChild('rendererCanvas', { static: true }) rendererCanvas!: ElementRef<HTMLCanvasElement>;

  @Input() activeMode: '2d' | '3d' = '3d';
  @Input() activeTrailer: TrailerPreset | null = null;
  @Input() userId = '';
  @Input() autoOptimizeAll = false;

  @Output() palletSelected = new EventEmitter<string | null>();
  @Output() edgeHoverRotate = new EventEmitter<{ x: number; y: number } | null>();
  @Output() spawnBlocked = new EventEmitter<string>();
  @Output() palletListChanged = new EventEmitter<PalletListItem[]>();
  @Output() layoutChanged = new EventEmitter<LayoutSnapshot>();

  private readonly themeService = inject(ThemeService);
  readonly i18n = inject(I18nService);

  selectedPalletId: string | null = null;
  private palletCounter = 0;
  private palletNumbers = new Map<string, number>();

  // Three.js core
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspCamera!: THREE.PerspectiveCamera;
  private orthoCamera!: THREE.OrthographicCamera;
  private orbitControls!: OrbitControls;
  private animationFrameId: number | null = null;

  // History for Undo/Redo
  private historyPast: LayoutSnapshot[] = [];
  private historyFuture: LayoutSnapshot[] = [];
  private isHistoryAction = false;
  private lastSnapshot: LayoutSnapshot | null = null;

  /** Returns whichever camera is currently active based on mode */
  private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.activeMode === '2d' ? this.orthoCamera : this.perspCamera;
  }

  // Trailer meshes
  private trailerBox!: THREE.Mesh;
  private trailerOutline!: THREE.LineSegments;
  private cab!: THREE.Mesh;
  private floorMesh!: THREE.Mesh;
  private gridHelper!: THREE.GridHelper;

  // ponytail: ground-plane progress bar (right side of trailer)
  private progressGroup = new THREE.Group();
  private progressFilled!: THREE.Mesh;
  private progressRemaining!: THREE.Mesh;
  private progressFilledLabel!: THREE.Sprite;
  private progressRemainingLabel!: THREE.Sprite;

  // Pallets
  private pallets: Map<string, PalletMeshBundle> = new Map();

  constructor() {
    effect(() => {
      const isDark = this.themeService.theme() === 'dark';
      this.applyThemeColors(isDark);
    });
  }

  // Dragging
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private draggedBundle: PalletMeshBundle | null = null;
  private dragOffset = new THREE.Vector3();
  private isDragging = false;
  private previousPosition = new THREE.Vector3();
  private pointerDownPos = new THREE.Vector2();
  private pointerDownTime = 0;

  // Trailer dims
  trailerL = 12.0;
  trailerW = 2.5;
  trailerH = 2.7;

  // Edge colors
  private readonly EDGE_COLOR_DEFAULT = 0x888888;
  private readonly EDGE_COLOR_SELECTED = 0x00d4ff;

  // Collision & Bounds constants
  private readonly COLLISION_SKIN = 0.02; // 2cm skin prevents false collisions on adjacent/flush pallets
  private readonly BOUNDS_TOLERANCE = 0.1; // 10cm tolerance prevents float rounding & clamped borders snapping back

  // Bound event handlers (for proper cleanup)
  private readonly boundOnResize = this.onWindowResize.bind(this);
  private readonly boundOnPointerDown = this.onPointerDown.bind(this);
  private readonly boundOnPointerMove = this.onPointerMove.bind(this);
  private readonly boundOnPointerUp = this.onPointerUp.bind(this);

  ngAfterViewInit(): void {
    this.initThree();
    this.createTrailerEnvironment();
    this.createProgressBar();
    this.handleModeChange();
    this.animate();
    this.lastSnapshot = this.getSnapshot();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeMode'] && !changes['activeMode'].firstChange) {
      this.handleModeChange();
    }
    if (changes['activeTrailer'] && !changes['activeTrailer'].firstChange) {
      this.applyTrailerPreset();
    }
  }

  ngOnDestroy(): void {
    // Cancel animation loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Remove event listeners
    window.removeEventListener('resize', this.boundOnResize);
    const canvas = this.rendererCanvas?.nativeElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.boundOnPointerDown);
      canvas.removeEventListener('pointermove', this.boundOnPointerMove);
      canvas.removeEventListener('pointerup', this.boundOnPointerUp);
    }

    // Dispose Three.js resources
    this.orbitControls?.dispose();
    this.renderer?.dispose();
  }

  // ─── PUBLIC API ───────────────────────────────────────────

  /** Save previous state to history and capture current state.
   *  Always call AFTER the mutation — pushes the pre-mutation snapshot
   *  (stored in lastSnapshot) then records the new current state. */
  pushHistory(): void {
    if (this.isHistoryAction) return;

    const current = this.getSnapshot();

    // ponytail: skip if nothing actually changed (e.g. click without drag)
    if (this.lastSnapshot && this.snapshotsEqual(this.lastSnapshot, current)) {
      return;
    }

    if (this.lastSnapshot) {
      this.historyPast.push(this.lastSnapshot);
      if (this.historyPast.length > 50) this.historyPast.shift();
      this.historyFuture = [];
    }

    this.lastSnapshot = current;
    this.layoutChanged.emit(current);
  }

  /** Compare two snapshots for equality (position, rotation, dimensions, color) */
  private snapshotsEqual(a: LayoutSnapshot, b: LayoutSnapshot): boolean {
    if (a.pallets.length !== b.pallets.length) return false;
    for (let i = 0; i < a.pallets.length; i++) {
      const pa = a.pallets[i], pb = b.pallets[i];
      if (pa.id !== pb.id) return false;
      if (pa.x !== pb.x || pa.y !== pb.y || pa.z !== pb.z) return false;
      if (pa.rotationY !== pb.rotationY) return false;
      if (pa.preset.color !== pb.preset.color) return false;
      if (pa.preset.length !== pb.preset.length || pa.preset.width !== pb.preset.width || pa.preset.height !== pb.preset.height) return false;
    }
    return true;
  }

  undo(): void {
    if (this.historyPast.length === 0) return;
    
    // Save current state to future before undoing
    const current = this.getSnapshot();
    this.historyFuture.push(current);
    
    const previous = this.historyPast.pop()!;
    this.loadFromSnapshot(previous, true);
    this.lastSnapshot = this.getSnapshot();
  }

  redo(): void {
    if (this.historyFuture.length === 0) return;
    
    // Save current state to past before redoing
    const current = this.getSnapshot();
    this.historyPast.push(current);
    
    const next = this.historyFuture.pop()!;
    this.loadFromSnapshot(next, true);
    this.lastSnapshot = this.getSnapshot();
  }

  getSnapshot(): LayoutSnapshot {
    const pallets: LayoutPalletInfo[] = [];
    this.pallets.forEach((bundle, id) => {
      pallets.push({
        id,
        preset: bundle.preset,
        x: bundle.mesh.position.x,
        y: bundle.mesh.position.y,
        z: bundle.mesh.position.z,
        rotationY: bundle.mesh.rotation.y
      });
    });
    return { id: Date.now().toString(), timestamp: Date.now(), pallets };
  }

  loadFromSnapshot(snapshot: LayoutSnapshot, fromHistory = false): void {
    this.isHistoryAction = true;
    this.resetLoad();
    
    for (const p of snapshot.pallets) {
      // Re-assign pallet numbers to match
      const palletNum = ++this.palletCounter;
      this.palletNumbers.set(p.id, palletNum);
      
      const rotated = p.rotationY > 0.1;
      const bundle = this.buildPalletMesh(p.preset, rotated, p.preset.color, p.id);
      const mesh = bundle.mesh;
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.rotationY;
      
      this.scene.add(mesh);
      this.pallets.set(p.id, bundle);
    }
    
    this.emitPalletList();
    this.updateProgressBar();
    this.isHistoryAction = false;
    
    if (!fromHistory) {
      // If loaded from menu, we should treat it as a new action for history
      this.pushHistory();
    } else {
      // Just emit for auto-save
      this.layoutChanged.emit(snapshot);
    }
  }

  /** Spawn a pallet from a saved preset (called by parent Dashboard) */
  spawnPalletFromPreset(preset: CargoPreset): void {
    if (this.autoOptimizeAll) {
      const currentItems = Array.from(this.pallets.values()).map(b => b.preset);
      currentItems.push(preset);

      // Save previous layout to revert if new pallet causes overflow
      const previousLayout = Array.from(this.pallets.values()).map(b => ({
        preset: b.preset,
        pos: b.mesh.position.clone(),
        rotated: b.mesh.rotation.y > 0.1
      }));

      const itemMap = new Map<string, { preset: CargoPreset; quantity: number }>();
      for (const p of currentItems) {
        if (!itemMap.has(p.id)) {
          itemMap.set(p.id, { preset: p, quantity: 1 });
        } else {
          itemMap.get(p.id)!.quantity++;
        }
      }
      const items = Array.from(itemMap.values());
      const result = this.autoLoadPallets(items);

      if (result.placed < result.total) {
        // Revert to previous layout
        this.resetLoad();
        for (const item of previousLayout) {
          this.spawnPalletAt(item.preset, item.pos.x, item.pos.y, item.pos.z, item.rotated);
        }
        this.spawnBlocked.emit(preset.name);
      }
      return;
    }

    const id = 'pallet-' + crypto.randomUUID().substring(0, 8);
    // ponytail: assign sequential number and random color per spawn
    const palletNum = ++this.palletCounter;
    this.palletNumbers.set(id, palletNum);
    const spawnColor = this.randomHslColor();

    // Try to find an optimal spot FIRST, to avoid creating garbage meshes if it fails
    const spot = this.findOptimalSpot(preset);

    if (!spot) {
      this.spawnBlocked.emit(preset.name);
      return;
    }

    const bundle = this.buildPalletMesh(preset, spot.rotated, spawnColor, id);
    const mesh = bundle.mesh;
    
    mesh.position.set(spot.x, spot.y, spot.z);
    if (spot.rotated) {
      mesh.rotation.y = Math.PI / 2;
    }

    this.scene.add(mesh);
    this.pallets.set(id, bundle);

    // Auto-select the newly spawned pallet
    this.selectPalletById(id);
    this.emitPalletList();
    this.pushHistory();
    this.updateProgressBar();
  }

  /**
   * Find an optimal, collision-free, supported spot for a pallet.
   * ponytail: scores candidate spots across all anchor points and both orientations
   * to strictly minimize the overall trailer length (max cargo Z extent).
   */
  private findOptimalSpot(
    preset: CargoPreset,
    customOccupied?: { x: number; y: number; z: number; w: number; l: number; h: number; stackable: boolean }[],
    preferredOrient?: 'asIs' | 'rotated' | 'forceAsIs' | 'forceRotated'
  ): { x: number; y: number; z: number; rotated: boolean } | null {
    const occupied = customOccupied || Array.from(this.pallets.values()).map(bundle => {
      const m = bundle.mesh;
      return {
        x: m.position.x,
        y: m.position.y,
        z: m.position.z,
        w: m.userData['width'] || 1.0,
        l: m.userData['length'] || 1.2,
        h: m.userData['height'] || 1.6,
        stackable: m.userData['stackable'] || false,
      };
    });

    const halfW = this.trailerW / 2;
    const halfL = this.trailerL / 2;
    const currentMaxZ = occupied.length > 0
      ? occupied.reduce((max, occ) => Math.max(max, occ.z + occ.l / 2), -halfL)
      : -halfL;

    let orientations = [
      { w: preset.width, l: preset.length, rotated: false },
      { w: preset.length, l: preset.width, rotated: true },
    ];

    if (preferredOrient === 'forceAsIs') {
      orientations = [{ w: preset.width, l: preset.length, rotated: false }];
    } else if (preferredOrient === 'forceRotated') {
      orientations = [{ w: preset.length, l: preset.width, rotated: true }];
    } else if (preferredOrient === 'rotated') {
      orientations.reverse();
    }

    const ph = preset.height;
    let bestSpot: { x: number; y: number; z: number; rotated: boolean; score: number } | null = null;

    for (const orient of orientations) {
      const pw = orient.w;
      const pl = orient.l;

      // Skip if dimensions exceed trailer bounds entirely
      if (pw > this.trailerW + 0.005 || pl > this.trailerL + 0.005 || ph > this.trailerH + 0.005) {
        continue;
      }

      // Generate rich anchor points for this specific orientation
      const xCoords = new Set<number>([-halfW, halfW - pw]);
      const yCoords = new Set<number>([0]);
      const zCoords = new Set<number>([-halfL]);

      for (const occ of occupied) {
        // X anchors: flush right, left-aligned, flush left, right-aligned
        xCoords.add(occ.x + occ.w / 2);
        xCoords.add(occ.x - occ.w / 2);
        xCoords.add(occ.x - occ.w / 2 - pw);
        xCoords.add(occ.x + occ.w / 2 - pw);

        // Z anchors: flush front, back-aligned
        zCoords.add(occ.z + occ.l / 2);
        zCoords.add(occ.z - occ.l / 2);

        // Y anchors: top of stackable boxes
        if (occ.stackable) {
          yCoords.add(occ.y + occ.h / 2);
        }
      }

      const sortedY = Array.from(yCoords)
        .filter(y => y >= -0.005 && y + ph <= this.trailerH + 0.005)
        .sort((a, b) => a - b);
      const sortedZ = Array.from(zCoords)
        .filter(z => z >= -halfL - 0.005 && z + pl <= halfL + 0.005)
        .sort((a, b) => a - b);
      const sortedX = Array.from(xCoords)
        .filter(x => x >= -halfW - 0.005 && x + pw <= halfW + 0.005)
        .sort((a, b) => a - b);

      for (const y of sortedY) {
        for (const z of sortedZ) {
          for (const x of sortedX) {
            const cx = x + pw / 2;
            const cy = y + ph / 2;
            const cz = z + pl / 2;

            if (cx - pw / 2 < -halfW - 0.005 || cx + pw / 2 > halfW + 0.005) continue;
            if (cz - pl / 2 < -halfL - 0.005 || cz + pl / 2 > halfL + 0.005) continue;
            if (cy + ph / 2 > this.trailerH + 0.005) continue;

            let overlaps = false;
            for (const occ of occupied) {
              const xOv = Math.abs(cx - occ.x) < (pw / 2 + occ.w / 2 - this.COLLISION_SKIN);
              const zOv = Math.abs(cz - occ.z) < (pl / 2 + occ.l / 2 - this.COLLISION_SKIN);
              const yOv = Math.abs(cy - occ.y) < (ph / 2 + occ.h / 2 - this.COLLISION_SKIN);
              if (xOv && zOv && yOv) {
                overlaps = true;
                break;
              }
            }
            if (overlaps) continue;

            let supported = y <= 0.005;
            if (!supported) {
              let supportArea = 0;
              const boxArea = pw * pl;
              for (const occ of occupied) {
                if (!occ.stackable) continue;
                if (Math.abs((occ.y + occ.h / 2) - y) > 0.015) continue;
                const ox = Math.min(cx + pw / 2, occ.x + occ.w / 2) - Math.max(cx - pw / 2, occ.x - occ.w / 2);
                const oz = Math.min(cz + pl / 2, occ.z + occ.l / 2) - Math.max(cz - pl / 2, occ.z - occ.l / 2);
                if (ox > 0.02 && oz > 0.02) {
                  supportArea += ox * oz;
                }
              }
              supported = supportArea >= boxArea * 0.45;
            }
            if (!supported) continue;

            const palletFrontZ = cz + pl / 2;
            const resultingMaxZ = Math.max(currentMaxZ, palletFrontZ);

            // Primary: minimize resulting trailer length (Z-extent)
            // Secondary: minimize pallet's own front Z (pack as deep into existing gaps as possible)
            // Tertiary: prefer bottom level (Y=0) before stacking unless stacking saves length
            // Quaternary: pack flush against left wall
            const score = resultingMaxZ * 100000 + palletFrontZ * 1000 + y * 50 + (x + halfW) * 1;

            if (!bestSpot || score < bestSpot.score) {
              bestSpot = { x: cx, y: cy, z: cz, rotated: orient.rotated, score };
            }
          }
        }
      }
    }

    return bestSpot ? { x: bestSpot.x, y: bestSpot.y, z: bestSpot.z, rotated: bestSpot.rotated } : null;
  }


  /** Rotate the currently selected pallet by 90° if space permits */
  rotateSelected(): boolean {
    if (!this.selectedPalletId) return false;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) return false;

    const { mesh } = bundle;
    const prevRotY = mesh.rotation.y;
    const prevPos = mesh.position.clone();
    const prevW = mesh.userData['width'];
    const prevL = mesh.userData['length'];

    // Hypothetical rotate (edges are children, so they rotate automatically)
    mesh.rotation.y += Math.PI / 2;
    mesh.userData['width'] = prevL;
    mesh.userData['length'] = prevW;

    this.clampObjectToTrailer(mesh);

    if (this.checkAABBOverlap(mesh) || this.isOutOfBounds(mesh)) {
      // Revert — no space
      mesh.rotation.y = prevRotY;
      mesh.position.copy(prevPos);
      mesh.userData['width'] = prevW;
      mesh.userData['length'] = prevL;
      return false;
    }

    this.pushHistory();
    this.updateProgressBar();
    return true;
  }

  private disposeBundle(bundle: PalletMeshBundle): void {
    this.scene.remove(bundle.mesh);
    bundle.mesh.geometry.dispose();
    bundle.edges.geometry.dispose();
    if (Array.isArray(bundle.mesh.material)) {
      bundle.mesh.material.forEach(m => m.dispose());
    } else {
      bundle.mesh.material.dispose();
    }
  }

  /** Delete the currently selected pallet */
  deleteSelected(): void {
    if (!this.selectedPalletId) return;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (bundle) {
      this.disposeBundle(bundle);
      this.pallets.delete(this.selectedPalletId);
    }
    this.selectedPalletId = null;
    this.palletSelected.emit(null);
    this.emitPalletList();
    this.pushHistory();
    this.updateProgressBar();
  }

  /** Clear all cargo */
  resetLoad(): void {
    this.selectedPalletId = null;
    this.draggedBundle = null;
    this.isDragging = false;

    this.pallets.forEach(bundle => {
      this.disposeBundle(bundle);
    });

    this.pallets.clear();
    this.palletNumbers.clear();
    this.palletCounter = 0;
    this.palletSelected.emit(null);
    this.emitPalletList();
    if (!this.isHistoryAction) {
      this.pushHistory();
    }
    this.updateProgressBar();
  }

  // ─── INIT ─────────────────────────────────────────────────

  private initThree(): void {
    const canvas = this.rendererCanvas.nativeElement;

    this.scene = new THREE.Scene();

    // The theme colors will be applied automatically by the effect once the scene is ready.
    const isDark = this.themeService.theme() === 'dark';
    this.applyThemeColors(isDark);

    // Perspective camera (3D mode)
    this.perspCamera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    this.perspCamera.position.set(14, 8, 14);

    // Orthographic camera (2D mode) — frustum updated in handleModeChange
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const frustumH = 10;
    this.orthoCamera = new THREE.OrthographicCamera(
      -frustumH * aspect / 2, frustumH * aspect / 2,
      frustumH / 2, -frustumH / 2,
      0.1, 200
    );
    this.orthoCamera.position.set(0, 50, 0);
    this.orthoCamera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight.position.set(8, 16, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    // Grid Floor is handled in applyThemeColors

    // Controls — start with perspective camera
    this.orbitControls = new OrbitControls(this.perspCamera, canvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;

    window.addEventListener('resize', this.boundOnResize);

    // Pointer events
    canvas.addEventListener('pointerdown', this.boundOnPointerDown);
    canvas.addEventListener('pointermove', this.boundOnPointerMove);
    canvas.addEventListener('pointerup', this.boundOnPointerUp);
  }

  private applyThemeColors(isDark: boolean): void {
    if (!this.scene) return;

    const bgColor = isDark ? '#0b0f19' : '#f0f2f5';
    const gridMajor = isDark ? 0x1e293b : 0x94a3b8;
    const gridMinor = isDark ? 0x111827 : 0xcbd5e1;
    const cabColor = isDark ? 0x475569 : 0x94a3b8; // Lighter gray for cab
    const floorColor = isDark ? 0x1a2332 : 0xe2e8f0;
    const trailerColor = isDark ? 0x475569 : 0x94a3b8;

    this.scene.background = new THREE.Color(bgColor);

    if (this.cab?.material) {
      (this.cab.material as THREE.MeshPhongMaterial).color.setHex(cabColor);
    }
    
    if (this.floorMesh?.material) {
      (this.floorMesh.material as THREE.MeshBasicMaterial).color.setHex(floorColor);
    }

    if (this.trailerBox?.material) {
      (this.trailerBox.material as THREE.MeshPhongMaterial).color.setHex(trailerColor);
    }

    // Recreate grid to apply colors
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
    }
    
    this.gridHelper = new THREE.GridHelper(30, 30, gridMajor, gridMinor);
    this.gridHelper.position.y = -0.01;
    this.scene.add(this.gridHelper);

    // ponytail: sync progress bar colors with theme
    this.updateProgressBar();
  }

  private createTrailerEnvironment(): void {
    const trailerGeo = new THREE.BoxGeometry(this.trailerW, this.trailerH, this.trailerL);

    const trailerMat = new THREE.MeshPhongMaterial({
      color: this.themeService.theme() === 'dark' ? 0x475569 : 0x94a3b8,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.trailerBox = new THREE.Mesh(trailerGeo, trailerMat);
    this.trailerBox.position.set(0, this.trailerH / 2, 0);
    this.scene.add(this.trailerBox);

    // Wireframe edges
    const edges = new THREE.EdgesGeometry(trailerGeo);
    this.trailerOutline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 }));
    this.trailerOutline.position.copy(this.trailerBox.position);
    this.scene.add(this.trailerOutline);

    // Floor plane for trailer (visible in 2D mode)
    const floorGeo = new THREE.PlaneGeometry(this.trailerW, this.trailerL);
    const floorMat = new THREE.MeshBasicMaterial({
      color: this.themeService.theme() === 'dark' ? 0x1a2332 : 0xe2e8f0,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.set(0, 0.01, 0);
    this.scene.add(this.floorMesh);

    // Cabin
    const cabW = 2.0, cabH = 2.4, cabL = 2.0;
    const cabGeo = new THREE.BoxGeometry(cabW, cabH, cabL);
    const cabColor = this.themeService.theme() === 'dark' ? 0x475569 : 0x94a3b8;
    const cabMat = new THREE.MeshPhongMaterial({ color: cabColor, flatShading: true });
    this.cab = new THREE.Mesh(cabGeo, cabMat);
    const cabCenterZ = -(this.trailerL / 2 + cabL / 2 + 0.5);
    this.cab.position.set(0, cabH / 2, cabCenterZ);
    this.scene.add(this.cab);

    // Camera target
    if (this.activeMode === '3d') {
      this.orbitControls.target.set(0, this.trailerH / 2, 0);
    } else {
      this.orbitControls.target.set(0, 0, 0);
    }
    this.orbitControls.update();
  }

  private applyTrailerPreset(): void {
    if (!this.trailerBox) return; // not yet initialized

    // Clear all pallets when switching trailers to avoid oversized cargo persisting
    this.resetLoad();

    const t = this.activeTrailer;
    this.trailerL = t ? t.length : 12.0;
    this.trailerW = t ? t.width : 2.5;
    this.trailerH = t ? t.height : 2.7;

    // Remove old trailer geometry
    this.scene.remove(this.trailerBox);
    this.scene.remove(this.trailerOutline);
    this.scene.remove(this.cab);
    this.scene.remove(this.floorMesh);

    this.trailerBox.geometry.dispose();
    this.trailerOutline.geometry.dispose();
    this.cab.geometry.dispose();
    this.floorMesh.geometry.dispose();

    this.createTrailerEnvironment();
    this.createProgressBar();
    this.handleModeChange();
  }

  // ─── LIVE EDITOR METHODS ──────────────────────────────────

  /** Live update trailer dimensions without clearing pallets */
  applyTrailerDimensions(l: number, w: number, h: number): void {
    if (!this.trailerBox) return;
    this.trailerL = l;
    this.trailerW = w;
    this.trailerH = h;

    this.scene.remove(this.trailerBox);
    this.scene.remove(this.trailerOutline);
    this.scene.remove(this.cab);
    this.scene.remove(this.floorMesh);

    this.trailerBox.geometry.dispose();
    this.trailerOutline.geometry.dispose();
    this.cab.geometry.dispose();
    this.floorMesh.geometry.dispose();

    this.createTrailerEnvironment();
    this.createProgressBar();
    if (this.activeMode === '2d') {
      this.updateOrthoFrustum();
    }
  }

  /** Get unrotated original dimensions of the selected pallet */
  getSelectedPalletDimensions(): { length: number; width: number; height: number } | null {
    if (!this.selectedPalletId) return null;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) return null;
    return {
      length: bundle.preset.length,
      width: bundle.preset.width,
      height: bundle.preset.height,
    };
  }

  /** Live update the selected pallet dimensions */
  updateSelectedPalletDimensions(length: number, width: number, height: number): void {
    if (!this.selectedPalletId) return;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) return;

    // Save back to preset so it remembers if unselected and reselected
    bundle.preset.length = length;
    bundle.preset.width = width;
    bundle.preset.height = height;

    bundle.mesh.geometry.dispose();
    const isRotated = bundle.mesh.rotation.y > 0.1;
    const effectiveW = isRotated ? length : width;
    const effectiveL = isRotated ? width : length;
    bundle.mesh.geometry = new THREE.BoxGeometry(effectiveW, height, effectiveL);

    bundle.edges.geometry.dispose();
    bundle.edges.geometry = new THREE.EdgesGeometry(bundle.mesh.geometry);

    bundle.mesh.userData['length'] = effectiveL;
    bundle.mesh.userData['width'] = effectiveW;
    bundle.mesh.userData['height'] = height;

    this.clampObjectToTrailer(bundle.mesh);
  }

  // ─── MODE ─────────────────────────────────────────────────

  /** Update orthographic frustum to fit the trailer with padding */
  private updateOrthoFrustum(): void {
    const canvas = this.rendererCanvas.nativeElement;
    if (!canvas || canvas.clientWidth === 0) return;

    const aspect = canvas.clientWidth / canvas.clientHeight;
    const padW = 2.0;
    const padL = 4.0;
    const viewW = this.trailerW + padW;
    const viewL = this.trailerL + padL;

    let frustumW: number, frustumH: number;
    if (viewL / viewW > aspect) {
      frustumH = viewL;
      frustumW = frustumH * aspect;
    } else {
      frustumW = viewW;
      frustumH = frustumW / aspect;
    }

    this.orthoCamera.left = -frustumW / 2;
    this.orthoCamera.right = frustumW / 2;
    this.orthoCamera.top = frustumH / 2;
    this.orthoCamera.bottom = -frustumH / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  private handleModeChange(): void {
    if (!this.orbitControls) return;
    const canvas = this.rendererCanvas.nativeElement;

    if (this.activeMode === '2d') {
      this.orbitControls.dispose();
      this.orthoCamera.position.set(0, 50, 0);
      this.orthoCamera.lookAt(0, 0, 0);
      this.updateOrthoFrustum();

      this.orbitControls = new OrbitControls(this.orthoCamera, canvas);
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.05;
      this.orbitControls.enableRotate = false;
      this.orbitControls.target.set(0, 0, 0);
      this.orbitControls.update();

      // Snap all pallets flat
      this.pallets.forEach(bundle => {
        const h = bundle.mesh.userData['height'] || 1.6;
        bundle.mesh.position.y = h / 2;
        this.clampObjectToTrailer(bundle.mesh);
      });
    } else {
      this.orbitControls.dispose();
      this.perspCamera.position.set(14, 8, 14);

      this.orbitControls = new OrbitControls(this.perspCamera, canvas);
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.05;
      this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
      this.orbitControls.enableRotate = true;
      this.orbitControls.target.set(0, this.trailerH / 2, 0);
      this.orbitControls.update();
    }
  }

  // ─── ANIMATION ────────────────────────────────────────────

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize(): void {
    const canvas = this.rendererCanvas.nativeElement;
    if (!canvas || canvas.clientWidth === 0) return;

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    this.updateOrthoFrustum();

    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  // ─── SELECTION ────────────────────────────────────────────

  selectPalletById(id: string | null): void {
    // Deselect previous
    if (this.selectedPalletId) {
      const prev = this.pallets.get(this.selectedPalletId);
      if (prev) {
        (prev.edges.material as THREE.LineBasicMaterial).color.setHex(this.EDGE_COLOR_DEFAULT);
      }
    }

    this.selectedPalletId = id;

    // Highlight new
    if (id) {
      const cur = this.pallets.get(id);
      if (cur) {
        (cur.edges.material as THREE.LineBasicMaterial).color.setHex(this.EDGE_COLOR_SELECTED);
      }
    }

    this.palletSelected.emit(id);
  }

  // ─── POINTER EVENTS ──────────────────────────────────────

  private onPointerDown(event: PointerEvent): void {
    const canvas = this.rendererCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

    this.pointerDownPos.set(event.clientX, event.clientY);
    this.pointerDownTime = Date.now();

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = Array.from(this.pallets.values()).map(b => b.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object as THREE.Mesh;
      const id = clickedMesh.userData['id'];
      const bundle = this.pallets.get(id);

      if (bundle) {
        this.selectPalletById(id);

        // Start drag
        this.draggedBundle = bundle;
        this.isDragging = true;
        this.previousPosition.copy(clickedMesh.position);
        canvas.style.cursor = 'grabbing';

        this.orbitControls.enabled = false;

        this.dragPlane.setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          clickedMesh.position
        );

        const intersection = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
          this.dragOffset.copy(clickedMesh.position).sub(intersection);
        }
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const canvas = this.rendererCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / canvas.clientHeight) * 2 + 1;

    if (!this.isDragging || !this.draggedBundle) {
      // Hover cursor
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const meshes = Array.from(this.pallets.values()).map(b => b.mesh);
      const intersects = this.raycaster.intersectObjects(meshes, false);
      canvas.style.cursor = intersects.length > 0 ? 'pointer' : 'default';

      // Edge-hover rotate check (only when pallet selected and hovering it)
      if (this.selectedPalletId) {
        this.checkEdgeHoverRotate();
      }
      return;
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersection = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
      const mesh = this.draggedBundle.mesh;
      const newPos = intersection.add(this.dragOffset);

      const prevX = mesh.position.x;
      const prevZ = mesh.position.z;

      const w = mesh.userData['width'] || 1.0;
      const l = mesh.userData['length'] || 1.2;
      const halfWidthLimit = this.trailerW / 2 - w / 2;
      const halfLengthLimit = this.trailerL / 2 - l / 2;

      const clampedX = Math.max(-halfWidthLimit, Math.min(halfWidthLimit, newPos.x));
      const clampedZ = Math.max(-halfLengthLimit, Math.min(halfLengthLimit, newPos.z));

      // Test X axis using clamped position
      mesh.position.x = clampedX;
      if (this.checkAABBOverlap(mesh)) {
        mesh.position.x = prevX;
      }

      // Test Z axis using clamped position
      mesh.position.z = clampedZ;
      if (this.checkAABBOverlap(mesh)) {
        mesh.position.z = prevZ;
      }

      // Y stacking
      if (this.activeMode === '2d') {
        mesh.position.y = (mesh.userData['height'] || 1.6) / 2;
      } else {
        this.applyDiscrete3DPhysicsStacking(mesh, mesh.position.y);
      }
      this.clampObjectToTrailer(mesh);
      // ponytail: live progress update during drag
      this.updateProgressBar();
    }

    // Dismiss edge-hover while dragging
    this.edgeHoverRotate.emit(null);
  }

  private onPointerUp(event: PointerEvent): void {
    const canvas = this.rendererCanvas.nativeElement;
    const dist = Math.hypot(event.clientX - this.pointerDownPos.x, event.clientY - this.pointerDownPos.y);
    const elapsed = Date.now() - this.pointerDownTime;

    if (this.isDragging && this.draggedBundle) {
      const mesh = this.draggedBundle.mesh;

      if (dist < 5 && elapsed < 300) {
        // This was a click, not a drag — selection already happened in pointerDown
        mesh.position.copy(this.previousPosition);
      } else {
        // Real drag — snap cleanly to walls, neighbor pallets, or grid with collision resolution
        const dragPos = mesh.position.clone();
        this.snapAndResolveCollision(mesh, dragPos);
      }

      this.orbitControls.enabled = true;
      this.isDragging = false;
      this.draggedBundle = null;
      canvas.style.cursor = 'default';

      // Show rotate button for the selected pallet after drag/tap (fixes mobile)
      if (this.selectedPalletId) {
        this.emitRotateButtonForSelected();
      }
      this.pushHistory();
      this.updateProgressBar();
    } else if (dist < 5) {
      // Clicked on empty space — deselect
      this.selectPalletById(null);
      this.edgeHoverRotate.emit(null);
    }
  }

  /**
   * Attempts to snap a mesh cleanly to nearby walls, neighbor pallets, or grid.
   * If any snap introduces a collision, nudges to the nearest non-colliding spot
   * or falls back to the valid pre-snap drag position instead of reverting all the way back.
   */
  private snapAndResolveCollision(mesh: THREE.Mesh, dragPos: THREE.Vector3): void {
    const snapW = mesh.userData['width'] || 1.0;
    const snapL = mesh.userData['length'] || 1.2;
    const meshId = mesh.userData['id'];

    const wallX = this.trailerW / 2 - snapW / 2;
    const wallZ = this.trailerL / 2 - snapL / 2;

    let candidateX = mesh.position.x;
    let candidateZ = mesh.position.z;

    // 1. Check flush snap to trailer wall (threshold: 10cm)
    let snappedWallX = false;
    if (Math.abs(candidateX - wallX) < 0.1) {
      candidateX = wallX;
      snappedWallX = true;
    } else if (Math.abs(candidateX + wallX) < 0.1) {
      candidateX = -wallX;
      snappedWallX = true;
    }

    let snappedWallZ = false;
    if (Math.abs(candidateZ - wallZ) < 0.1) {
      candidateZ = wallZ;
      snappedWallZ = true;
    } else if (Math.abs(candidateZ + wallZ) < 0.1) {
      candidateZ = -wallZ;
      snappedWallZ = true;
    }

    // 2. Check flush snap to neighbor pallet edges (threshold: 8cm)
    let snappedNeighborX = false;
    let snappedNeighborZ = false;

    this.pallets.forEach(bundle => {
      if (bundle.mesh.userData['id'] === meshId) return;
      const other = bundle.mesh;
      const otherW = other.userData['width'] || 1.0;
      const otherL = other.userData['length'] || 1.2;

      // X snap: if pallets overlap or touch in Z
      const zClose = Math.abs(candidateZ - other.position.z) < (snapL / 2 + otherL / 2 - 0.02);
      if (zClose && !snappedWallX && !snappedNeighborX) {
        const flushRight = other.position.x + otherW / 2 + snapW / 2;
        const flushLeft = other.position.x - otherW / 2 - snapW / 2;
        if (Math.abs(candidateX - flushRight) < 0.08) {
          candidateX = flushRight;
          snappedNeighborX = true;
        } else if (Math.abs(candidateX - flushLeft) < 0.08) {
          candidateX = flushLeft;
          snappedNeighborX = true;
        }
      }

      // Z snap: if pallets overlap or touch in X
      const xClose = Math.abs(candidateX - other.position.x) < (snapW / 2 + otherW / 2 - 0.02);
      if (xClose && !snappedWallZ && !snappedNeighborZ) {
        const flushFront = other.position.z + otherL / 2 + snapL / 2;
        const flushBack = other.position.z - otherL / 2 - snapL / 2;
        if (Math.abs(candidateZ - flushFront) < 0.08) {
          candidateZ = flushFront;
          snappedNeighborZ = true;
        } else if (Math.abs(candidateZ - flushBack) < 0.08) {
          candidateZ = flushBack;
          snappedNeighborZ = true;
        }
      }
    });

    // 3. Fallback to 10cm grid snap if not wall-snapped or neighbor-snapped
    if (!snappedWallX && !snappedNeighborX) {
      candidateX = Math.round(candidateX * 10) / 10;
    }
    if (!snappedWallZ && !snappedNeighborZ) {
      candidateZ = Math.round(candidateZ * 10) / 10;
    }

    mesh.position.x = candidateX;
    mesh.position.z = candidateZ;

    // Apply vertical positioning
    if (this.activeMode === '2d') {
      mesh.position.y = (mesh.userData['height'] || 1.6) / 2;
    } else {
      this.applyDiscrete3DPhysicsStacking(mesh, mesh.position.y);
    }

    this.clampObjectToTrailer(mesh);

    // 4. Validate snapped position
    if (!this.checkAABBOverlap(mesh) && !this.isOutOfBounds(mesh)) {
      return; // Snapped position is valid!
    }

    // 5. Collision detected: try small nudges around snapped position
    const nudgeDeltas = [
      { x: 0, z: 0.05 }, { x: 0, z: -0.05 },
      { x: 0.05, z: 0 }, { x: -0.05, z: 0 },
      { x: 0, z: 0.1 }, { x: 0, z: -0.1 },
      { x: 0.1, z: 0 }, { x: -0.1, z: 0 },
      { x: 0.05, z: 0.05 }, { x: -0.05, z: -0.05 }
    ];

    const postSnapX = mesh.position.x;
    const postSnapZ = mesh.position.z;

    for (const d of nudgeDeltas) {
      mesh.position.x = postSnapX + d.x;
      mesh.position.z = postSnapZ + d.z;
      this.clampObjectToTrailer(mesh);
      if (!this.checkAABBOverlap(mesh) && !this.isOutOfBounds(mesh)) {
        return; // Valid nudged position found
      }
    }

    // 6. Try the pre-snap dragged position (which user saw before mouse release)
    mesh.position.copy(dragPos);
    this.clampObjectToTrailer(mesh);
    if (!this.checkAABBOverlap(mesh) && !this.isOutOfBounds(mesh)) {
      return; // Pre-snap position is valid
    }

    // 7. Last resort: revert to position before drag started
    mesh.position.copy(this.previousPosition);
    this.clampObjectToTrailer(mesh);
  }

  // ─── ROTATE BUTTON HELPERS ────────────────────────────────

  /** Compute screen position for rotate button above the selected pallet */
  private getRotateButtonScreenPos(mesh: THREE.Mesh): { x: number; y: number } {
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    worldPos.y += (mesh.userData['height'] || 1.6) / 2 + 0.3;
    const cam = this.camera;
    const screenPos = worldPos.clone().project(cam);

    const canvas = this.rendererCanvas.nativeElement;
    const x = (screenPos.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * canvas.clientHeight;
    return { x, y };
  }

  /** Emit rotate button position for the currently selected pallet (for mobile tap) */
  private emitRotateButtonForSelected(): void {
    if (!this.selectedPalletId) return;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) return;
    this.edgeHoverRotate.emit(this.getRotateButtonScreenPos(bundle.mesh));
  }

  private checkEdgeHoverRotate(): void {
    if (!this.selectedPalletId) {
      this.edgeHoverRotate.emit(null);
      return;
    }

    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) {
      this.edgeHoverRotate.emit(null);
      return;
    }

    const mesh = bundle.mesh;

    // Show rotate button when hovering over the selected pallet (any position)
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(mesh, false);
    if (intersects.length > 0) {
      this.edgeHoverRotate.emit(this.getRotateButtonScreenPos(mesh));
      return;
    }

    this.edgeHoverRotate.emit(null);
  }

  // ─── AABB COLLISION ──────────────────────────────────────

  private checkAABBOverlap(mesh: THREE.Mesh): boolean {
    const meshId = mesh.userData['id'];
    const w1 = mesh.userData['width'] || 1.0;
    const l1 = mesh.userData['length'] || 1.2;
    const h1 = mesh.userData['height'] || 1.6;

    let collides = false;

    this.pallets.forEach(bundle => {
      if (collides || bundle.mesh.userData['id'] === meshId) return;

      const other = bundle.mesh;
      const w2 = other.userData['width'] || 1.0;
      const l2 = other.userData['length'] || 1.2;
      const h2 = other.userData['height'] || 1.6;

      const xOverlap = Math.abs(mesh.position.x - other.position.x) < (w1 / 2 + w2 / 2 - this.COLLISION_SKIN);
      const zOverlap = Math.abs(mesh.position.z - other.position.z) < (l1 / 2 + l2 / 2 - this.COLLISION_SKIN);
      const yOverlap = Math.abs(mesh.position.y - other.position.y) < (h1 / 2 + h2 / 2 - this.COLLISION_SKIN);

      if (xOverlap && zOverlap && yOverlap) {
        collides = true;
      }
    });

    return collides;
  }

  private isOutOfBounds(mesh: THREE.Mesh): boolean {
    const w = mesh.userData['width'] || 1.0;
    const l = mesh.userData['length'] || 1.2;
    const h = mesh.userData['height'] || 1.6;

    const x = mesh.position.x;
    const y = mesh.position.y;
    const z = mesh.position.z;

    const hw = w / 2;
    const hl = l / 2;

    const tHW = this.trailerW / 2;
    const tHL = this.trailerL / 2;

    if (x - hw < -tHW - this.BOUNDS_TOLERANCE || x + hw > tHW + this.BOUNDS_TOLERANCE) return true;
    if (z - hl < -tHL - this.BOUNDS_TOLERANCE || z + hl > tHL + this.BOUNDS_TOLERANCE) return true;
    if (y - h / 2 < 0 - this.BOUNDS_TOLERANCE || y + h / 2 > this.trailerH + this.BOUNDS_TOLERANCE) return true;

    return false;
  }

  private applyDiscrete3DPhysicsStacking(dragged: THREE.Mesh, prevY: number): void {
    const draggedId = dragged.userData['id'];
    const draggedW = dragged.userData['width'] || 1.0;
    const draggedL = dragged.userData['length'] || 1.2;
    const draggedH = dragged.userData['height'] || 1.6;

    let targetY = draggedH / 2;
    let highestStackY = 0;

    this.pallets.forEach(bundle => {
      const other = bundle.mesh;
      if (other.userData['id'] === draggedId) return;

      const otherW = other.userData['width'] || 1.0;
      const otherL = other.userData['length'] || 1.2;
      const otherH = other.userData['height'] || 1.6;

      const xOverlap = Math.abs(dragged.position.x - other.position.x) < (draggedW / 2 + otherW / 2 - this.COLLISION_SKIN);
      const zOverlap = Math.abs(dragged.position.z - other.position.z) < (draggedL / 2 + otherL / 2 - this.COLLISION_SKIN);

      if (xOverlap && zOverlap) {
        const isStackable = other.userData['stackable'] === true;

        if (isStackable) {
          const stackY = other.position.y + otherH / 2 + draggedH / 2;
          if (stackY > highestStackY) {
            highestStackY = stackY;
          }
        } else {
          const verticalOverlap = Math.abs(dragged.position.y - other.position.y) < (draggedH / 2 + otherH / 2 - this.COLLISION_SKIN);
          if (verticalOverlap) {
            targetY = draggedH / 2;
          }
        }
      }
    });

    if (highestStackY > 0) {
      targetY = highestStackY;
    }

    dragged.position.y = targetY;

    if (this.checkAABBOverlap(dragged)) {
      dragged.position.y = prevY;
    }
  }

  private clampObjectToTrailer(mesh: THREE.Mesh): void {
    const w = mesh.userData['width'] || 1.0;
    const h = mesh.userData['height'] || 1.6;
    const l = mesh.userData['length'] || 1.2;

    const halfWidthLimit = this.trailerW / 2 - w / 2;
    mesh.position.x = Math.max(-halfWidthLimit, Math.min(halfWidthLimit, mesh.position.x));

    const bottomLimit = h / 2;
    const topLimit = this.trailerH - h / 2;
    mesh.position.y = Math.max(bottomLimit, Math.min(topLimit, mesh.position.y));

    const halfLengthLimit = this.trailerL / 2 - l / 2;
    mesh.position.z = Math.max(-halfLengthLimit, Math.min(halfLengthLimit, mesh.position.z));
  }

  // ─── AUTO-LOADOUT SOLVER ──────────────────────────────────

  /**
   * Auto-load pallets using multi-strategy strip packing with Z-length minimization.
   * Evaluates multiple heuristic orderings & row orientations, runs a compaction pass,
   * and selects the layout that packs the most cargo into the smallest total trailer length.
   * Returns { placed: number, total: number } for UI feedback.
   */
  autoLoadPallets(items: { preset: CargoPreset; quantity: number }[]): { placed: number; total: number } {
    this.resetLoad();

    const allPallets: CargoPreset[] = [];
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        allPallets.push({ ...item.preset });
      }
    }

    const total = allPallets.length;
    if (total === 0) {
      return { placed: 0, total: 0 };
    }

    interface PlacedItem {
      preset: CargoPreset;
      x: number;
      y: number;
      z: number;
      w: number;
      l: number;
      h: number;
      stackable: boolean;
      rotated: boolean;
    }

    // Helper to simulate packing a given pallet order with a given orientation preference
    const simulatePacking = (
      palletList: CargoPreset[],
      prefOrient?: 'asIs' | 'rotated' | 'forceAsIs' | 'forceRotated'
    ): { placed: PlacedItem[]; maxZ: number } => {
      const occupied: PlacedItem[] = [];

      for (const preset of palletList) {
        const spot = this.findOptimalSpot(preset, occupied, prefOrient);
        if (spot) {
          const pw = spot.rotated ? preset.length : preset.width;
          const pl = spot.rotated ? preset.width : preset.length;
          occupied.push({
            preset,
            x: spot.x,
            y: spot.y,
            z: spot.z,
            w: pw,
            l: pl,
            h: preset.height,
            stackable: preset.stackable,
            rotated: spot.rotated
          });
        }
      }

      this.compactOccupied(occupied);

      const halfL = this.trailerL / 2;
      const maxZ = occupied.length > 0
        ? occupied.reduce((max, occ) => Math.max(max, occ.z + occ.l / 2), -halfL)
        : -halfL;

      return { placed: occupied, maxZ };
    };

    // Helper for mathematically optimal row-partitioning of identical pallets
    const simulateRowBatched = (palletList: CargoPreset[]): { placed: PlacedItem[]; maxZ: number } => {
      const occupied: PlacedItem[] = [];

      // Group pallets by preset ID / dimensions
      const groups = new Map<string, CargoPreset[]>();
      for (const p of palletList) {
        const k = `${p.name}_${p.length}_${p.width}_${p.height}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(p);
      }

      for (const [_, group] of groups) {
        const p0 = group[0];
        const w = p0.width;
        const l = p0.length;
        const k1 = Math.floor(this.trailerW / w);
        const k2 = Math.floor(this.trailerW / l);

        let bestR1 = 0;
        let minLen = Infinity;
        const maxR1 = k1 > 0 ? Math.ceil(group.length / k1) : 0;
        for (let r1 = 0; r1 <= maxR1; r1++) {
          const rem = Math.max(0, group.length - r1 * k1);
          const r2 = k2 > 0 ? Math.ceil(rem / k2) : (rem > 0 ? 9999 : 0);
          const len = r1 * l + r2 * w;
          if (len < minLen) {
            minLen = len;
            bestR1 = r1;
          }
        }

        const count1 = bestR1 * k1;
        for (let i = 0; i < group.length; i++) {
          const p = group[i];
          const force = i < count1 ? 'forceAsIs' : 'forceRotated';
          const spot = this.findOptimalSpot(p, occupied, force);
          if (spot) {
            const pw = spot.rotated ? p.length : p.width;
            const pl = spot.rotated ? p.width : p.length;
            occupied.push({
              preset: p,
              x: spot.x,
              y: spot.y,
              z: spot.z,
              w: pw,
              l: pl,
              h: p.height,
              stackable: p.stackable,
              rotated: spot.rotated
            });
          }
        }
      }

      this.compactOccupied(occupied);
      const halfL = this.trailerL / 2;
      const maxZ = occupied.length > 0
        ? occupied.reduce((max, occ) => Math.max(max, occ.z + occ.l / 2), -halfL)
        : -halfL;
      return { placed: occupied, maxZ };
    };

    // Define multiple heuristic variations to compare
    const strategies: { name: string; run: () => { placed: PlacedItem[]; maxZ: number } }[] = [
      // 1. Footprint area desc
      {
        name: 'area_desc',
        run: () => simulatePacking([...allPallets].sort((a, b) => (b.width * b.length) - (a.width * a.length)))
      },
      // 2. Volume desc
      {
        name: 'volume_desc',
        run: () => simulatePacking([...allPallets].sort((a, b) => (b.width * b.length * b.height) - (a.width * a.length * a.height)))
      },
      // 3. Max dimension desc (standard strip packing best-fit decreasing)
      {
        name: 'max_dim_desc',
        run: () => simulatePacking([...allPallets].sort((a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length)))
      },
      // 4. Min dimension desc
      {
        name: 'min_dim_desc',
        run: () => simulatePacking([...allPallets].sort((a, b) => Math.min(b.width, b.length) - Math.min(a.width, a.length)))
      },
      // 5. Presets grouped (keep identical cargo together for neat rows)
      {
        name: 'grouped_presets',
        run: () => {
          const map = new Map<string, CargoPreset[]>();
          for (const p of allPallets) {
            const k = `${p.name}_${p.length}_${p.width}_${p.height}`;
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(p);
          }
          return simulatePacking(Array.from(map.values()).flat());
        }
      },
      // 6. Presets grouped with rotated bias
      {
        name: 'grouped_presets_rotated',
        run: () => {
          const map = new Map<string, CargoPreset[]>();
          for (const p of allPallets) {
            const k = `${p.name}_${p.length}_${p.width}_${p.height}`;
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(p);
          }
          return simulatePacking(Array.from(map.values()).flat(), 'rotated');
        }
      },
      // 7. Stackable first, then area desc
      {
        name: 'stackable_first',
        run: () => simulatePacking([...allPallets].sort((a, b) => {
          if (a.stackable !== b.stackable) return a.stackable ? -1 : 1;
          return (b.width * b.length) - (a.width * a.length);
        }))
      },
      // 8. Forced as-is orientation
      {
        name: 'forced_asIs',
        run: () => simulatePacking([...allPallets], 'forceAsIs')
      },
      // 9. Forced rotated orientation
      {
        name: 'forced_rotated',
        run: () => simulatePacking([...allPallets], 'forceRotated')
      },
      // 10. Mathematically optimal row batching
      {
        name: 'row_batched',
        run: () => simulateRowBatched([...allPallets])
      }
    ];

    let bestResult: { placed: PlacedItem[]; maxZ: number } | null = null;
    let bestScore = Infinity;

    for (const strat of strategies) {
      const result = strat.run();
      const unplacedPenalty = (total - result.placed.length) * 1000000;
      const lengthScore = (result.maxZ + this.trailerL / 2) * 1000;
      const score = unplacedPenalty + lengthScore;

      if (!bestResult || score < bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }

    if (bestResult) {
      for (const item of bestResult.placed) {
        this.spawnPalletAt(item.preset, item.x, item.y, item.z, item.rotated);
      }
    }

    this.emitPalletList();
    this.pushHistory();
    this.updateProgressBar();
    return { placed: bestResult ? bestResult.placed.length : 0, total };
  }

  /**
   * ponytail: compact placed items towards -halfL (back wall) to eliminate any gaps.
   */
  private compactOccupied(
    occupied: { preset: CargoPreset; x: number; y: number; z: number; w: number; l: number; h: number; stackable: boolean; rotated: boolean }[]
  ): void {
    if (occupied.length <= 1) return;

    const halfL = this.trailerL / 2;

    // Sort items by z ascending (from back to front)
    occupied.sort((a, b) => a.z - b.z);

    for (let i = 0; i < occupied.length; i++) {
      const item = occupied[i];
      let testZ = item.z;
      const minPossibleZ = -halfL + item.l / 2;

      while (testZ - 0.05 >= minPossibleZ - 0.001) {
        const candidateZ = testZ - 0.05;
        let collides = false;
        for (let j = 0; j < occupied.length; j++) {
          if (i === j) continue;
          const other = occupied[j];
          const xOv = Math.abs(item.x - other.x) < (item.w / 2 + other.w / 2 - this.COLLISION_SKIN);
          const zOv = Math.abs(candidateZ - other.z) < (item.l / 2 + other.l / 2 - this.COLLISION_SKIN);
          const yOv = Math.abs(item.y - other.y) < (item.h / 2 + other.h / 2 - this.COLLISION_SKIN);
          if (xOv && zOv && yOv) {
            collides = true;
            break;
          }
        }
        if (collides) break;

        const targetY = item.y - item.h / 2;
        let supported = targetY <= 0.005;
        if (!supported) {
          let supportArea = 0;
          for (let j = 0; j < occupied.length; j++) {
            if (i === j) continue;
            const other = occupied[j];
            if (!other.stackable) continue;
            if (Math.abs((other.y + other.h / 2) - targetY) > 0.015) continue;
            const ox = Math.min(item.x + item.w / 2, other.x + other.w / 2) - Math.max(item.x - item.w / 2, other.x - other.w / 2);
            const oz = Math.min(candidateZ + item.l / 2, other.z + other.l / 2) - Math.max(candidateZ - item.l / 2, other.z - other.l / 2);
            if (ox > 0.02 && oz > 0.02) supportArea += ox * oz;
          }
          supported = supportArea >= (item.w * item.l) * 0.45;
        }
        if (!supported) break;

        testZ = candidateZ;
      }
      item.z = Math.round(testZ * 100) / 100;
    }
  }

  private spawnPalletAt(preset: CargoPreset, x: number, y: number, z: number, rotated: boolean): void {
    const id = 'pallet-' + crypto.randomUUID().substring(0, 8);
    const palletNum = ++this.palletCounter;
    this.palletNumbers.set(id, palletNum);
    const spawnColor = this.randomHslColor();

    const bundle = this.buildPalletMesh(preset, rotated, spawnColor, id);
    const mesh = bundle.mesh;
    mesh.position.set(x, y, z);
    if (rotated) {
      mesh.rotation.y = Math.PI / 2;
    }

    this.scene.add(mesh);
    this.pallets.set(id, bundle);
  }

  // ─── GROUND PROGRESS BAR ─────────────────────────────

  /** ponytail: build a text sprite from canvas — reused for both labels */
  private makeTextSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 64px Inter, Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.0, 0.5, 1);
    return sprite;
  }

  /** Update sprite text in-place by repainting its canvas texture */
  private updateSpriteText(sprite: THREE.Sprite, text: string, color: string): void {
    const mat = sprite.material as THREE.SpriteMaterial;
    const tex = mat.map!;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 64px Inter, Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    tex.needsUpdate = true;
  }

  /** Create the progress bar group — called after trailer environment is built */
  private createProgressBar(): void {
    // Remove old if exists
    if (this.progressGroup.parent) {
      this.scene.remove(this.progressGroup);
      this.progressGroup.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
          child.geometry?.dispose();
          const m = child.material;
          if (Array.isArray(m)) m.forEach(mat => mat.dispose());
          else m.dispose();
        }
      });
    }
    this.progressGroup = new THREE.Group();

    const barHeight = 0.25;

    // Filled segment (blue — same as trailer outline)
    const filledGeo = new THREE.PlaneGeometry(barHeight, 1);
    const filledMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    this.progressFilled = new THREE.Mesh(filledGeo, filledMat);
    this.progressFilled.rotation.x = -Math.PI / 2;
    this.progressGroup.add(this.progressFilled);

    // Remaining segment (cab color)
    const isDark = this.themeService.theme() === 'dark';
    const cabHex = isDark ? 0x475569 : 0x94a3b8;
    const remGeo = new THREE.PlaneGeometry(barHeight, 1);
    const remMat = new THREE.MeshBasicMaterial({
      color: cabHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    this.progressRemaining = new THREE.Mesh(remGeo, remMat);
    this.progressRemaining.rotation.x = -Math.PI / 2;
    this.progressGroup.add(this.progressRemaining);

    // Labels
    this.progressFilledLabel = this.makeTextSprite('0.0m', '#3b82f6');
    this.progressGroup.add(this.progressFilledLabel);

    const cabCss = isDark ? '#94a3b8' : '#475569';
    this.progressRemainingLabel = this.makeTextSprite(`${this.trailerL.toFixed(1)}m`, cabCss);
    this.progressGroup.add(this.progressRemainingLabel);

    this.progressGroup.position.y = 0.02;
    this.scene.add(this.progressGroup);
    this.updateProgressBar();
  }

  /** Recalculate and reposition the progress bar segments + labels */
  private updateProgressBar(): void {
    if (!this.progressFilled) return;

    const halfL = this.trailerL / 2;
    const barX = this.trailerW / 2 + 0.35; // right side offset
    const barHeight = 0.25;

    // ponytail: cargo packs from -halfL (back, far from cab) towards +halfL (front, near cab)
    // Filled = span from back wall (-halfL) to the frontmost cargo edge (maxCargoZ)
    let maxCargoZ = -halfL;
    this.pallets.forEach(bundle => {
      const m = bundle.mesh;
      const l = m.userData['length'] || 1.2;
      const cargoEnd = m.position.z + l / 2;
      if (cargoEnd > maxCargoZ) maxCargoZ = cargoEnd;
    });

    const filledLength = this.pallets.size > 0 ? (maxCargoZ - (-halfL)) : 0;
    const remainingLength = this.trailerL - filledLength;

    // Filled bar
    if (filledLength > 0.001) {
      this.progressFilled.visible = true;
      this.progressFilled.geometry.dispose();
      this.progressFilled.geometry = new THREE.PlaneGeometry(barHeight, filledLength);
      this.progressFilled.rotation.x = -Math.PI / 2;
      const filledCenterZ = -halfL + filledLength / 2;
      this.progressFilled.position.set(barX, 0, filledCenterZ);
    } else {
      this.progressFilled.visible = false;
    }

    // Remaining bar
    if (remainingLength > 0.001) {
      this.progressRemaining.visible = true;
      this.progressRemaining.geometry.dispose();
      this.progressRemaining.geometry = new THREE.PlaneGeometry(barHeight, remainingLength);
      this.progressRemaining.rotation.x = -Math.PI / 2;
      const remCenterZ = -halfL + filledLength + remainingLength / 2;
      this.progressRemaining.position.set(barX, 0, remCenterZ);
    } else {
      this.progressRemaining.visible = false;
    }

    // Labels
    const isDark = this.themeService.theme() === 'dark';
    const labelY = 0.3;

    if (filledLength > 0.001) {
      this.progressFilledLabel.visible = true;
      const filledCenterZ = -halfL + filledLength / 2;
      this.progressFilledLabel.position.set(barX, labelY, filledCenterZ);
      this.updateSpriteText(this.progressFilledLabel, `${filledLength.toFixed(1)}m`, '#3b82f6');
    } else {
      this.progressFilledLabel.visible = false;
    }

    if (remainingLength > 0.001) {
      this.progressRemainingLabel.visible = true;
      const remCenterZ = -halfL + filledLength + remainingLength / 2;
      this.progressRemainingLabel.position.set(barX, labelY, remCenterZ);
      const cabCss = isDark ? '#94a3b8' : '#64748b';
      this.updateSpriteText(this.progressRemainingLabel, `${remainingLength.toFixed(1)}m`, cabCss);
    } else {
      this.progressRemainingLabel.visible = false;
    }

    // Update remaining color based on theme
    const cabHex = isDark ? 0x475569 : 0x94a3b8;
    (this.progressRemaining.material as THREE.MeshBasicMaterial).color.setHex(cabHex);
  }

  private buildPalletMesh(preset: CargoPreset, rotated: boolean, color: string, id: string): PalletMeshBundle {
    const geo = new THREE.BoxGeometry(preset.width, preset.height, preset.length);
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      flatShading: true,
      shininess: 30,
      transparent: true,
      opacity: 0.88,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      id,
      name: preset.name,
      length: rotated ? preset.width : preset.length,
      width: rotated ? preset.length : preset.width,
      height: preset.height,
      stackable: preset.stackable,
      color: color,
    };

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: this.EDGE_COLOR_DEFAULT, linewidth: 1 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    mesh.add(edges);

    return { mesh, edges, preset: { ...preset, color } };
  }

  // ─── PUBLIC API: Pallet List & Editing ────────────────

  /** Build a flat list of all pallets for the sidebar */
  getPalletList(): PalletListItem[] {
    const list: PalletListItem[] = [];
    this.pallets.forEach((bundle, id) => {
      list.push({
        id,
        number: this.palletNumbers.get(id) ?? 0,
        name: bundle.preset.name,
        length: bundle.preset.length,
        width: bundle.preset.width,
        height: bundle.preset.height,
        color: bundle.preset.color,
        stackable: bundle.preset.stackable,
      });
    });
    // ponytail: sort by number for stable display order
    list.sort((a, b) => a.number - b.number);
    return list;
  }

  /** Update a pallet's color by id */
  updatePalletColor(id: string, color: string): void {
    const bundle = this.pallets.get(id);
    if (!bundle) return;
    bundle.preset.color = color;
    bundle.mesh.userData['color'] = color;
    (bundle.mesh.material as THREE.MeshPhongMaterial).color.set(color);
    this.emitPalletList();
    this.pushHistory();
  }

  /** Update a specific pallet's dimensions by id */
  updatePalletDimensionsById(id: string, length: number, width: number, height: number): void {
    const bundle = this.pallets.get(id);
    if (!bundle) return;

    bundle.preset.length = length;
    bundle.preset.width = width;
    bundle.preset.height = height;

    bundle.mesh.geometry.dispose();
    const isRotated = bundle.mesh.rotation.y > 0.1;
    const effectiveW = isRotated ? length : width;
    const effectiveL = isRotated ? width : length;
    bundle.mesh.geometry = new THREE.BoxGeometry(effectiveW, height, effectiveL);

    bundle.edges.geometry.dispose();
    bundle.edges.geometry = new THREE.EdgesGeometry(bundle.mesh.geometry);

    bundle.mesh.userData['length'] = effectiveL;
    bundle.mesh.userData['width'] = effectiveW;
    bundle.mesh.userData['height'] = height;

    this.clampObjectToTrailer(bundle.mesh);
    this.emitPalletList();
    this.pushHistory();
    this.updateProgressBar();
  }

  /** Delete a pallet by id (for sidebar delete button) */
  deletePalletById(id: string): void {
    const bundle = this.pallets.get(id);
    if (!bundle) return;
    this.disposeBundle(bundle);
    this.pallets.delete(id);
    if (this.selectedPalletId === id) {
      this.selectedPalletId = null;
      this.palletSelected.emit(null);
    }
    this.emitPalletList();
    this.pushHistory();
    this.updateProgressBar();
  }

  private emitPalletList(): void {
    this.palletListChanged.emit(this.getPalletList());
  }

  /** ponytail: random saturated color via HSL for visual variety */
  private randomHslColor(): string {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 55%)`;
  }
}
