import {
  Component, ElementRef, OnInit, OnDestroy, ViewChild, AfterViewInit,
  Input, Output, EventEmitter, OnChanges, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CargoPreset, TrailerPreset } from '../../services/storage.service';

interface PalletMeshBundle {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  preset: CargoPreset;
}

@Component({
  selector: 'app-three-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './three-canvas.html',
  styleUrl: './three-canvas.css',
})
export class ThreeCanvas implements OnInit, OnDestroy, AfterViewInit, OnChanges {
  @ViewChild('rendererCanvas', { static: true }) rendererCanvas!: ElementRef<HTMLCanvasElement>;

  @Input() activeMode: '2d' | '3d' = '3d';
  @Input() activeTrailer: TrailerPreset | null = null;
  @Input() userId = '';

  @Output() palletSelected = new EventEmitter<string | null>();
  @Output() edgeHoverRotate = new EventEmitter<{ x: number; y: number } | null>();

  selectedPalletId: string | null = null;

  // Three.js core
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspCamera!: THREE.PerspectiveCamera;
  private orthoCamera!: THREE.OrthographicCamera;
  private orbitControls!: OrbitControls;

  /** Returns whichever camera is currently active based on mode */
  private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.activeMode === '2d' ? this.orthoCamera : this.perspCamera;
  }

  // Trailer meshes
  private trailerBox!: THREE.Mesh;
  private trailerOutline!: THREE.LineSegments;
  private cab!: THREE.Mesh;
  private floorMesh!: THREE.Mesh;

  // Pallets
  private pallets: Map<string, PalletMeshBundle> = new Map();

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

  ngOnInit() {}

  ngAfterViewInit() {
    this.initThree();
    this.createTrailerEnvironment();
    this.handleModeChange();
    this.animate();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['activeMode'] && !changes['activeMode'].firstChange) {
      this.handleModeChange();
    }
    if (changes['activeTrailer'] && !changes['activeTrailer'].firstChange) {
      this.applyTrailerPreset();
    }
  }

  ngOnDestroy() {
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  // ─── PUBLIC API ───────────────────────────────────────────

  /** Spawn a pallet from a saved preset (called by parent Dashboard) */
  spawnPalletFromPreset(preset: CargoPreset) {
    const id = 'pallet-' + Math.random().toString(36).substring(2, 9);

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

    // Position near trailer rear opening
    const startZ = this.trailerL / 2 - preset.length / 2;
    const startY = preset.height / 2;
    mesh.position.set(0, startY, startZ);

    if (this.checkAABBOverlap(mesh) || this.isOutOfBounds(mesh)) {
      alert(`Cannot spawn "${preset.name}". The spawn area is blocked or the pallet is too large.`);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      return;
    }

    this.scene.add(mesh);
    const bundle: PalletMeshBundle = { mesh, edges, preset };
    this.pallets.set(id, bundle);

    // Auto-select the newly spawned pallet
    this.selectPalletById(id);
  }

  /** Rotate the currently selected pallet by 90° if space permits */
  rotateSelected(): boolean {
    if (!this.selectedPalletId) return false;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) return false;

    const { mesh } = bundle;
    const prevRotY = mesh.rotation.y;
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
      mesh.userData['width'] = prevW;
      mesh.userData['length'] = prevL;
      const revertGeo = new THREE.BoxGeometry(prevW, mesh.userData['height'], prevL);
      bundle.edges.geometry.dispose();
      bundle.edges.geometry = new THREE.EdgesGeometry(revertGeo);
      revertGeo.dispose();
      this.clampObjectToTrailer(mesh);
      return false;
    }

    return true;
  }

  /** Delete the currently selected pallet */
  deleteSelected() {
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
  resetLoad() {
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

  /** Get count of spawned pallets */
  getPalletCount(): number {
    return this.pallets.size;
  }

  // ─── INIT ─────────────────────────────────────────────────

  private initThree() {
    const canvas = this.rendererCanvas.nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0f19');

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

    // Grid Floor
    const gridHelper = new THREE.GridHelper(30, 30, '#1e293b', '#111827');
    gridHelper.position.y = -0.01;
    this.scene.add(gridHelper);

    // Controls — start with perspective camera
    this.orbitControls = new OrbitControls(this.perspCamera, canvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;

    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Pointer events
    canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
  }

  private createTrailerEnvironment() {
    const trailerGeo = new THREE.BoxGeometry(this.trailerW, this.trailerH, this.trailerL);

    const trailerMat = new THREE.MeshPhongMaterial({
      color: 0x475569,
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
      color: 0x1a2332,
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
    const cabMat = new THREE.MeshPhongMaterial({ color: 0x1e293b, flatShading: true });
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

  private applyTrailerPreset() {
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
  private updateOrthoFrustum() {
    const canvas = this.rendererCanvas.nativeElement;
    if (!canvas || canvas.clientWidth === 0) return;

    const aspect = canvas.clientWidth / canvas.clientHeight;
    // Add padding so the full trailer + cab is visible
    const padW = 2.0;
    const padL = 4.0; // extra for cab
    const viewW = this.trailerW + padW;
    const viewL = this.trailerL + padL;

    // Pick the larger dimension scaled by aspect
    let frustumW: number, frustumH: number;
    if (viewL / viewW > aspect) {
      // Trailer length is the limiting dimension
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

  private handleModeChange() {
    if (!this.orbitControls) return;
    const canvas = this.rendererCanvas.nativeElement;

    if (this.activeMode === '2d') {
      // Switch controls to orthographic camera
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
      // Switch controls to perspective camera
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

  private animate() {
    requestAnimationFrame(() => this.animate());
    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize() {
    const canvas = this.rendererCanvas.nativeElement;
    if (!canvas || canvas.clientWidth === 0) return;

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    this.updateOrthoFrustum();

    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  // ─── SELECTION ────────────────────────────────────────────

  private selectPalletById(id: string | null) {
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

  private onPointerDown(event: PointerEvent) {
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

  private onPointerMove(event: PointerEvent) {
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
        this.checkEdgeHoverRotate(event.clientX, event.clientY);
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

      // Calculate clamped target positions FIRST
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

  private onPointerUp(event: PointerEvent) {
    const canvas = this.rendererCanvas.nativeElement;
    const dist = Math.hypot(event.clientX - this.pointerDownPos.x, event.clientY - this.pointerDownPos.y);
    const elapsed = Date.now() - this.pointerDownTime;

    if (this.isDragging && this.draggedBundle) {
      const mesh = this.draggedBundle.mesh;

      if (dist < 5 && elapsed < 300) {
        // This was a click, not a drag — selection already happened in pointerDown
        // Just restore position (no move)
        mesh.position.copy(this.previousPosition);
      } else {
        // Real drag — snap to grid
        mesh.position.x = Math.round(mesh.position.x * 10) / 10;
        mesh.position.z = Math.round(mesh.position.z * 10) / 10;

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
  private emitRotateButtonForSelected() {
    if (!this.selectedPalletId) return;
    const bundle = this.pallets.get(this.selectedPalletId);
    if (!bundle) return;
    this.edgeHoverRotate.emit(this.getRotateButtonScreenPos(bundle.mesh));
  }

  private checkEdgeHoverRotate(screenX: number, screenY: number) {
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

      const xOverlap = Math.abs(mesh.position.x - other.position.x) < (w1 / 2 + w2 / 2 - 0.03);
      const zOverlap = Math.abs(mesh.position.z - other.position.z) < (l1 / 2 + l2 / 2 - 0.03);
      const yOverlap = Math.abs(mesh.position.y - other.position.y) < (h1 / 2 + h2 / 2 - 0.03);

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

    // Use a small margin (0.05) to allow for floating point inaccuracies
    if (x - hw < -tHW - 0.05 || x + hw > tHW + 0.05) return true;
    if (z - hl < -tHL - 0.05 || z + hl > tHL + 0.05) return true;
    if (y - h / 2 < 0 - 0.05 || y + h / 2 > this.trailerH + 0.05) return true;

    return false;
  }

  private applyDiscrete3DPhysicsStacking(dragged: THREE.Mesh, prevY: number) {
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

      const xOverlap = Math.abs(dragged.position.x - other.position.x) < (draggedW / 2 + otherW / 2 - 0.05);
      const zOverlap = Math.abs(dragged.position.z - other.position.z) < (draggedL / 2 + otherL / 2 - 0.05);

      if (xOverlap && zOverlap) {
        const isStackable = other.userData['stackable'] === true;

        if (isStackable) {
          const stackY = other.position.y + otherH / 2 + draggedH / 2;
          if (stackY > highestStackY) {
            highestStackY = stackY;
          }
        } else {
          const verticalOverlap = Math.abs(dragged.position.y - other.position.y) < (draggedH / 2 + otherH / 2 - 0.05);
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

  private clampObjectToTrailer(mesh: THREE.Mesh) {
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

    // Track occupied positions as simple AABB list for fast overlap testing
    const occupied: { x: number; z: number; y: number; w: number; l: number; h: number; stackable: boolean }[] = [];

    const halfW = this.trailerW / 2;
    const halfL = this.trailerL / 2;
    const step = 0.05; // scan step in meters

    for (const preset of allPallets) {
      let didPlace = false;

      // Try both orientations
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

        // Scan from back-left (−halfL, −halfW) to front-right
        for (let z = -halfL + pl / 2; z <= halfL - pl / 2 + step / 2; z += step) {
          if (didPlace) break;
          for (let x = -halfW + pw / 2; x <= halfW - pw / 2 + step / 2; x += step) {
            const y = ph / 2; // on the floor

            // Check overlap with all occupied
            let overlaps = false;
            for (const occ of occupied) {
              const xOv = Math.abs(x - occ.x) < (pw / 2 + occ.w / 2 - 0.02);
              const zOv = Math.abs(z - occ.z) < (pl / 2 + occ.l / 2 - 0.02);
              const yOv = Math.abs(y - occ.y) < (ph / 2 + occ.h / 2 - 0.02);
              if (xOv && zOv && yOv) {
                overlaps = true;
                break;
              }
            }

            if (!overlaps && y + ph / 2 <= this.trailerH + 0.01) {
              // Place it!
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

          // Try stacking on each stackable occupied pallet
          for (const base of occupied) {
            if (didPlace) break;
            if (!base.stackable) continue;

            const stackY = base.y + base.h / 2 + ph / 2;
            if (stackY + ph / 2 > this.trailerH + 0.01) continue; // exceeds trailer height

            // Try placing on top of this base
            const x = base.x;
            const z = base.z;

            // Check if fits within trailer width/length
            if (x - pw / 2 < -halfW - 0.01 || x + pw / 2 > halfW + 0.01) continue;
            if (z - pl / 2 < -halfL - 0.01 || z + pl / 2 > halfL + 0.01) continue;

            // Check overlap with all other occupied
            let overlaps = false;
            for (const occ of occupied) {
              const xOv = Math.abs(x - occ.x) < (pw / 2 + occ.w / 2 - 0.02);
              const zOv = Math.abs(z - occ.z) < (pl / 2 + occ.l / 2 - 0.02);
              const yOv = Math.abs(stackY - occ.y) < (ph / 2 + occ.h / 2 - 0.02);
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
  private spawnPalletAt(preset: CargoPreset, x: number, y: number, z: number, rotated: boolean) {
    const id = 'pallet-' + Math.random().toString(36).substring(2, 9);

    const effectiveW = rotated ? preset.length : preset.width;
    const effectiveL = rotated ? preset.width : preset.length;

    const geo = new THREE.BoxGeometry(effectiveW, preset.height, effectiveL);
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
      length: effectiveL,
      width: effectiveW,
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
