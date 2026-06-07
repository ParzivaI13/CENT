import {
  Component, ElementRef, OnDestroy, ViewChild, AfterViewInit,
  Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, effect
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CargoPreset, TrailerPreset } from '../../services/storage.service';
import { ThemeService } from '../../services/theme.service';
import { I18nService } from '../../services/i18n.service';

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

  private readonly themeService = inject(ThemeService);
  readonly i18n = inject(I18nService);

  selectedPalletId: string | null = null;

  // Three.js core
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspCamera!: THREE.PerspectiveCamera;
  private orthoCamera!: THREE.OrthographicCamera;
  private orbitControls!: OrbitControls;
  private animationFrameId: number | null = null;

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

  // Bound event handlers (for proper cleanup)
  private readonly boundOnResize = this.onWindowResize.bind(this);
  private readonly boundOnPointerDown = this.onPointerDown.bind(this);
  private readonly boundOnPointerMove = this.onPointerMove.bind(this);
  private readonly boundOnPointerUp = this.onPointerUp.bind(this);

  ngAfterViewInit(): void {
    this.initThree();
    this.createTrailerEnvironment();
    this.handleModeChange();
    this.animate();
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

  /** Spawn a pallet from a saved preset (called by parent Dashboard) */
  spawnPalletFromPreset(preset: CargoPreset): void {
    if (this.autoOptimizeAll) {
      const currentItems = Array.from(this.pallets.values()).map(b => b.preset);
      currentItems.push(preset);

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
        this.spawnBlocked.emit(preset.name);
      }
      return;
    }

    const id = 'pallet-' + crypto.randomUUID().substring(0, 8);

    // Mesh
    const geo = new THREE.BoxGeometry(preset.width, preset.height, preset.length);
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(preset.color),
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
      length: preset.length,
      width: preset.width,
      height: preset.height,
      stackable: preset.stackable,
      color: preset.color,
    };

    // Wireframe edges
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: this.EDGE_COLOR_DEFAULT, linewidth: 1 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    mesh.add(edges); // child of mesh so it moves together

    // Try to find an optimal spot
    const spot = this.findOptimalSpot(preset);

    if (!spot) {
      this.spawnBlocked.emit(preset.name);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      return;
    }

    mesh.position.set(spot.x, spot.y, spot.z);
    if (spot.rotated) {
      mesh.rotation.y = Math.PI / 2;
      mesh.userData['width'] = preset.length;
      mesh.userData['length'] = preset.width;
    }

    this.scene.add(mesh);
    const bundle: PalletMeshBundle = { mesh, edges, preset };
    this.pallets.set(id, bundle);

    // Auto-select the newly spawned pallet
    this.selectPalletById(id);
  }

  private findOptimalSpot(preset: CargoPreset): { x: number, y: number, z: number, rotated: boolean } | null {
    const occupied: { x: number; z: number; y: number; w: number; l: number; h: number; stackable: boolean }[] = [];
    this.pallets.forEach(bundle => {
      const m = bundle.mesh;
      occupied.push({
        x: m.position.x,
        y: m.position.y,
        z: m.position.z,
        w: m.userData['width'] || 1.0,
        l: m.userData['length'] || 1.2,
        h: m.userData['height'] || 1.6,
        stackable: m.userData['stackable'] || false,
      });
    });

    const halfW = this.trailerW / 2;
    const halfL = this.trailerL / 2;
    const step = 0.05;

    const orientations = [
      { w: preset.width, l: preset.length },
      { w: preset.length, l: preset.width },
    ];

    const ph = preset.height;

    // --- FLOOR LAYER ---
    for (const orient of orientations) {
      const pw = orient.w;
      const pl = orient.l;

      for (let z = -halfL + pl / 2; z <= halfL - pl / 2 + step / 2; z += step) {
        for (let x = -halfW + pw / 2; x <= halfW - pw / 2 + step / 2; x += step) {
          const y = ph / 2;
          let overlaps = false;
          for (const occ of occupied) {
            const xOv = Math.abs(x - occ.x) < (pw / 2 + occ.w / 2 - 0.005);
            const zOv = Math.abs(z - occ.z) < (pl / 2 + occ.l / 2 - 0.005);
            const yOv = Math.abs(y - occ.y) < (ph / 2 + occ.h / 2 - 0.005);
            if (xOv && zOv && yOv) {
              overlaps = true;
              break;
            }
          }

          if (!overlaps && y + ph / 2 <= this.trailerH + 0.01) {
            return { x, y, z, rotated: orient.w !== preset.width };
          }
        }
      }
    }

    // --- STACKING LAYER ---
    for (const orient of orientations) {
      const pw = orient.w;
      const pl = orient.l;

      for (const base of occupied) {
        if (!base.stackable) continue;

        const stackY = base.y + base.h / 2 + ph / 2;
        if (stackY + ph / 2 > this.trailerH + 0.01) continue;

        const x = base.x;
        const z = base.z;

        if (x - pw / 2 < -halfW - 0.01 || x + pw / 2 > halfW + 0.01) continue;
        if (z - pl / 2 < -halfL - 0.01 || z + pl / 2 > halfL + 0.01) continue;

        let overlaps = false;
        for (const occ of occupied) {
          const xOv = Math.abs(x - occ.x) < (pw / 2 + occ.w / 2 - 0.005);
          const zOv = Math.abs(z - occ.z) < (pl / 2 + occ.l / 2 - 0.005);
          const yOv = Math.abs(stackY - occ.y) < (ph / 2 + occ.h / 2 - 0.005);
          if (xOv && zOv && yOv) {
            overlaps = true;
            break;
          }
        }

        if (!overlaps) {
          return { x, y: stackY, z, rotated: orient.w !== preset.width };
        }
      }
    }

    return null;
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

    return true;
  }

  /** Delete the currently selected pallet */
  deleteSelected(): void {
    if (!this.selectedPalletId) return;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (bundle) {
      this.scene.remove(bundle.mesh);
      bundle.mesh.geometry.dispose();
      bundle.edges.geometry.dispose();
      if (Array.isArray(bundle.mesh.material)) {
        bundle.mesh.material.forEach(m => m.dispose());
      } else {
        bundle.mesh.material.dispose();
      }
      this.pallets.delete(this.selectedPalletId);
    }
    this.selectedPalletId = null;
    this.palletSelected.emit(null);
  }

  /** Clear all cargo */
  resetLoad(): void {
    this.selectedPalletId = null;
    this.draggedBundle = null;
    this.isDragging = false;

    this.pallets.forEach(bundle => {
      this.scene.remove(bundle.mesh);
      bundle.mesh.geometry.dispose();
      bundle.edges.geometry.dispose();
      if (Array.isArray(bundle.mesh.material)) {
        bundle.mesh.material.forEach(m => m.dispose());
      } else {
        bundle.mesh.material.dispose();
      }
    });

    this.pallets.clear();
    this.palletSelected.emit(null);
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
    this.handleModeChange();
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

  private selectPalletById(id: string | null): void {
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
      
      // Enforce the 0.5m cabin gap
      const frontLimit = halfLengthLimit - 0.5;

      const clampedX = Math.max(-halfWidthLimit, Math.min(halfWidthLimit, newPos.x));
      const clampedZ = Math.max(-halfLengthLimit, Math.min(frontLimit, newPos.z));

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
        // Real drag — snap to grid
        mesh.position.x = Math.round(mesh.position.x * 10) / 10;
        mesh.position.z = Math.round(mesh.position.z * 10) / 10;

        // Snap to trailer wall if within one grid step (fixes Math.round asymmetry)
        const snapW = mesh.userData['width'] || 1.0;
        const snapL = mesh.userData['length'] || 1.2;
        const wallX = this.trailerW / 2 - snapW / 2;
        const wallZ = this.trailerL / 2 - snapL / 2;
        if (Math.abs(mesh.position.x - wallX) < 0.1) mesh.position.x = wallX;
        if (Math.abs(mesh.position.x + wallX) < 0.1) mesh.position.x = -wallX;
        if (Math.abs(mesh.position.z - wallZ) < 0.1) mesh.position.z = wallZ;
        if (Math.abs(mesh.position.z + wallZ) < 0.1) mesh.position.z = -wallZ;

        if (this.activeMode === '2d') {
          mesh.position.y = (mesh.userData['height'] || 1.6) / 2;
        } else {
          this.applyDiscrete3DPhysicsStacking(mesh, mesh.position.y);
          mesh.position.y = Math.round(mesh.position.y * 10) / 10;
        }

        // Final overlap check
        if (this.checkAABBOverlap(mesh) || this.isOutOfBounds(mesh)) {
          mesh.position.copy(this.previousPosition);
        }

        this.clampObjectToTrailer(mesh);
      }

      this.orbitControls.enabled = true;
      this.isDragging = false;
      this.draggedBundle = null;
      canvas.style.cursor = 'default';

      // Show rotate button for the selected pallet after drag/tap (fixes mobile)
      if (this.selectedPalletId) {
        this.emitRotateButtonForSelected();
      }
    } else if (dist < 5) {
      // Clicked on empty space — deselect
      this.selectPalletById(null);
      this.edgeHoverRotate.emit(null);
    }
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

      const xOverlap = Math.abs(mesh.position.x - other.position.x) < (w1 / 2 + w2 / 2 - 0.005);
      const zOverlap = Math.abs(mesh.position.z - other.position.z) < (l1 / 2 + l2 / 2 - 0.005);
      const yOverlap = Math.abs(mesh.position.y - other.position.y) < (h1 / 2 + h2 / 2 - 0.005);

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

    if (x - hw < -tHW - 0.05 || x + hw > tHW + 0.05) return true;
    if (z - hl < -tHL - 0.05 || z + hl > tHL + 0.05) return true;
    if (y - h / 2 < 0 - 0.05 || y + h / 2 > this.trailerH + 0.05) return true;

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

      const xOverlap = Math.abs(dragged.position.x - other.position.x) < (draggedW / 2 + otherW / 2 - 0.005);
      const zOverlap = Math.abs(dragged.position.z - other.position.z) < (draggedL / 2 + otherL / 2 - 0.005);

      if (xOverlap && zOverlap) {
        const isStackable = other.userData['stackable'] === true;

        if (isStackable) {
          const stackY = other.position.y + otherH / 2 + draggedH / 2;
          if (stackY > highestStackY) {
            highestStackY = stackY;
          }
        } else {
          const verticalOverlap = Math.abs(dragged.position.y - other.position.y) < (draggedH / 2 + otherH / 2 - 0.005);
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

  /** Auto-load pallets using a bottom-left-fill bin packing algorithm.
   *  Returns { placed: number, total: number } for UI feedback. */
  autoLoadPallets(items: { preset: CargoPreset; quantity: number }[]): { placed: number; total: number } {
    // Clear existing cargo
    this.resetLoad();

    // Flatten and sort by footprint area (largest first)
    const allPallets: CargoPreset[] = [];
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        allPallets.push({ ...item.preset });
      }
    }
    allPallets.sort((a, b) => (b.width * b.length) - (a.width * a.length));

    const total = allPallets.length;
    let placed = 0;

    // Track occupied positions as simple AABB list
    const occupied: { x: number; z: number; y: number; w: number; l: number; h: number; stackable: boolean }[] = [];

    const halfW = this.trailerW / 2;
    const halfL = this.trailerL / 2;
    const step = 0.05;

    for (const preset of allPallets) {
      let didPlace = false;

      const orientations = [
        { w: preset.width, l: preset.length },
        { w: preset.length, l: preset.width },
      ];

      // --- FLOOR LAYER ---
      for (const orient of orientations) {
        if (didPlace) break;
        const pw = orient.w;
        const pl = orient.l;
        const ph = preset.height;

        for (let z = -halfL + pl / 2; z <= halfL - pl / 2 + step / 2; z += step) {
          if (didPlace) break;
          for (let x = -halfW + pw / 2; x <= halfW - pw / 2 + step / 2; x += step) {
            const y = ph / 2;

            let overlaps = false;
            for (const occ of occupied) {
              const xOv = Math.abs(x - occ.x) < (pw / 2 + occ.w / 2 - 0.005);
              const zOv = Math.abs(z - occ.z) < (pl / 2 + occ.l / 2 - 0.005);
              const yOv = Math.abs(y - occ.y) < (ph / 2 + occ.h / 2 - 0.005);
              if (xOv && zOv && yOv) {
                overlaps = true;
                break;
              }
            }

            if (!overlaps && y + ph / 2 <= this.trailerH + 0.01) {
              const isRotated = orient.w !== preset.width;
              this.spawnPalletAt(preset, x, y, z, isRotated);
              occupied.push({ x, z, y, w: pw, l: pl, h: ph, stackable: preset.stackable });
              placed++;
              didPlace = true;
              break;
            }
          }
        }
      }

      // --- STACKING LAYER ---
      if (!didPlace) {
        for (const orient of orientations) {
          if (didPlace) break;
          const pw = orient.w;
          const pl = orient.l;
          const ph = preset.height;

          for (const base of occupied) {
            if (didPlace) break;
            if (!base.stackable) continue;

            const stackY = base.y + base.h / 2 + ph / 2;
            if (stackY + ph / 2 > this.trailerH + 0.01) continue;

            const x = base.x;
            const z = base.z;

            if (x - pw / 2 < -halfW - 0.01 || x + pw / 2 > halfW + 0.01) continue;
            if (z - pl / 2 < -halfL - 0.01 || z + pl / 2 > halfL + 0.01) continue;

            let overlaps = false;
            for (const occ of occupied) {
              const xOv = Math.abs(x - occ.x) < (pw / 2 + occ.w / 2 - 0.005);
              const zOv = Math.abs(z - occ.z) < (pl / 2 + occ.l / 2 - 0.005);
              const yOv = Math.abs(stackY - occ.y) < (ph / 2 + occ.h / 2 - 0.005);
              if (xOv && zOv && yOv) {
                overlaps = true;
                break;
              }
            }

            if (!overlaps) {
              const isRotated = orient.w !== preset.width;
              this.spawnPalletAt(preset, x, stackY, z, isRotated);
              occupied.push({ x, z, y: stackY, w: pw, l: pl, h: ph, stackable: preset.stackable });
              placed++;
              didPlace = true;
            }
          }
        }
      }
    }

    return { placed, total };
  }

  /** Spawn a pallet at an exact position (used by auto-loader) */
  private spawnPalletAt(preset: CargoPreset, x: number, y: number, z: number, rotated: boolean): void {
    const id = 'pallet-' + crypto.randomUUID().substring(0, 8);

    const geo = new THREE.BoxGeometry(preset.width, preset.height, preset.length);
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(preset.color),
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
      color: preset.color,
    };

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: this.EDGE_COLOR_DEFAULT, linewidth: 1 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    mesh.add(edges);

    mesh.position.set(x, y, z);
    if (rotated) {
      mesh.rotation.y = Math.PI / 2;
    }

    this.scene.add(mesh);
    this.pallets.set(id, { mesh, edges, preset });
  }
}
