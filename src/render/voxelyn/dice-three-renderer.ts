import type { DiceFaceDef, RolledDie } from '../../domain/shared/types';
import { makeDieFaceTexturePayload } from './dice-face-textures';
import { getDiceFaceIconRevision } from './dice-renderer';

export interface DiceVector3 {
  x: number;
  y: number;
  z: number;
}

export interface DiceQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface DieMeshState {
  mesh: any;
  faceIndex: number;
  faceId: string;
  iconRevision: number;
  inactive: boolean;
  baseScale: number;
  fullFaces: boolean;
}

const faceIndexToMaterialIndex = (faceIndex: number): number => {
  const normalized = ((faceIndex % 6) + 6) % 6;
  if (normalized === 0) return 2; // +Y top
  if (normalized === 1) return 0; // +X right
  if (normalized === 2) return 1; // -X left
  if (normalized === 3) return 4; // +Z front
  if (normalized === 4) return 5; // -Z back
  return 3; // -Y bottom
};

const placeholderFace = (sideIndex: number): DiceFaceDef => ({
  id: `placeholder_${sideIndex}`,
  label: `Lado ${sideIndex + 1}`,
  kind: 'special',
  value: sideIndex + 1,
  tags: [],
  target: 'self',
  effects: [],
});

const baseScaleForDiceCount = (count: number): number => {
  if (count >= 10) return 0.7;
  if (count >= 8) return 0.82;
  if (count >= 6) return 0.92;
  if (count >= 5) return 1;
  return 1.08;
};

const DIE_FACE_TEXTURE_SIZE = 128;

export class DiceThreeRenderer {
  private canvas: HTMLCanvasElement | null = null;

  private contextCanvas: HTMLCanvasElement | null = null;

  private readyState: 'idle' | 'pending' | 'ready' | 'failed' = 'idle';

  private initPromise: Promise<boolean> | null = null;

  private three: any = null;

  private renderer: any = null;

  private scene: any = null;

  private camera: any = null;

  private ambientLight: any = null;

  private keyLight: any = null;

  private floor: any = null;

  private floorTexture: any = null;

  private readonly dice = new Map<string, DieMeshState>();

  private selectedRollId: string | null = null;

  private qualityPreset: 'performance' | 'quality' = 'performance';

  private raycaster: any = null;

  private pointer: any = null;

  private projectVector: any = null;

  private cameraTargetRadius = 3.1;

  private contextLost = false;

  public async attach(canvas: HTMLCanvasElement): Promise<boolean> {
    const canvasChanged = this.contextCanvas !== canvas;
    if (canvasChanged && this.readyState === 'failed') {
      this.readyState = 'idle';
      this.initPromise = null;
      this.contextLost = false;
    }
    if (this.contextCanvas !== canvas) {
      this.unbindContextEvents();
      this.contextCanvas = canvas;
      this.bindContextEvents(canvas);
    }
    this.canvas = canvas;
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.touchAction = 'none';
    this.contextLost = false;

    const ready = await this.ensureReady();
    if (!ready) {
      return false;
    }

    this.resize();
    return true;
  }

  public setSelectedRollId(rollId: string | null): void {
    this.selectedRollId = rollId;
  }

  public setQualityPreset(preset: 'performance' | 'quality'): void {
    if (this.qualityPreset === preset) {
      return;
    }
    this.qualityPreset = preset;
    this.resize();
  }

  public setDieInactive(rollId: string, inactive: boolean): void {
    const state = this.dice.get(rollId);
    if (!state) {
      return;
    }
    state.inactive = inactive;
  }

  public pickRollIdAtClient(clientX: number, clientY: number): string | null {
    if (
      this.readyState !== 'ready' ||
      !this.canvas ||
      !this.camera ||
      !this.raycaster ||
      !this.pointer
    ) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const px = ((clientX - rect.left) / rect.width) * 2 - 1;
    const py = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.set(px, py);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshes = Array.from(this.dice.values()).map((entry) => entry.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const mesh = hit?.object;
      const found = Array.from(this.dice.entries()).find(([, state]) => state.mesh === mesh);
      if (!found) {
        continue;
      }
      if (found[1].inactive) {
        continue;
      }
      return found[0];
    }

    return null;
  }

  public getRollScreenAnchor(rollId: string): { x: number; y: number } | null {
    if (
      this.readyState !== 'ready' ||
      !this.canvas ||
      !this.camera ||
      !this.projectVector
    ) {
      return null;
    }

    const state = this.dice.get(rollId);
    if (!state) {
      return null;
    }

    this.projectVector.copy(state.mesh.position);
    this.projectVector.project(this.camera);

    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((this.projectVector.x + 1) * 0.5) * rect.width,
      y: ((1 - (this.projectVector.y + 1) * 0.5) * rect.height) - 8,
    };
  }

  public syncDice(rolls: RolledDie[], dieFacesByRollId?: ReadonlyMap<string, DiceFaceDef[]>): void {
    if (this.readyState !== 'ready' || !this.scene) {
      return;
    }

    const nextIds = new Set<string>();
    for (const roll of rolls) {
      nextIds.add(roll.rollId);
      const existing = this.dice.get(roll.rollId);
      const dieFaces = dieFacesByRollId?.get(roll.rollId);
      const wantsFullFaces = Array.isArray(dieFaces) && dieFaces.length >= 6;
      const iconRevision = getDiceFaceIconRevision(roll.face.id);
      if (!existing) {
        this.dice.set(roll.rollId, this.createDieMesh(roll, dieFaces));
        continue;
      }
      if (
        existing.faceId !== roll.face.id ||
        existing.faceIndex !== roll.faceIndex ||
        (wantsFullFaces && !existing.fullFaces) ||
        existing.iconRevision !== iconRevision
      ) {
        this.patchDieMaterials(existing.mesh, roll.face, roll.faceIndex, dieFaces);
        existing.faceId = roll.face.id;
        existing.faceIndex = roll.faceIndex;
        existing.iconRevision = iconRevision;
        existing.fullFaces = wantsFullFaces;
      }
    }

    for (const [rollId, state] of this.dice) {
      if (nextIds.has(rollId)) {
        continue;
      }
      this.disposeMesh(state.mesh);
      this.scene.remove(state.mesh);
      this.dice.delete(rollId);
    }

    const baseScale = baseScaleForDiceCount(rolls.length);
    for (const state of this.dice.values()) {
      state.baseScale = baseScale;
    }
    this.updateCameraTopDown(rolls.length);
  }

  public setDieTransform(
    rollId: string,
    position: DiceVector3,
    rotation: DiceQuaternion,
  ): void {
    const state = this.dice.get(rollId);
    if (!state) {
      return;
    }

    state.mesh.position.set(position.x, position.y, position.z);
    state.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  public render(): void {
    if (this.readyState !== 'ready' || !this.renderer || !this.scene || !this.camera || this.isContextLost()) {
      return;
    }

    this.resize();

    for (const [rollId, state] of this.dice) {
      const materials = Array.isArray(state.mesh.material)
        ? (state.mesh.material as any[])
        : [state.mesh.material];
      const selected = this.selectedRollId === rollId && !state.inactive;
      for (const material of materials) {
        if (material && 'emissiveIntensity' in material) {
          material.emissiveIntensity = selected ? 0.18 : 0;
          if (selected && material.emissive && typeof material.emissive.setHex === 'function') {
            material.emissive.setHex(0x7a3f08);
          }
          material.opacity = state.inactive ? 0.35 : 1;
          material.transparent = state.inactive;
        }
      }
      state.mesh.scale.setScalar(state.baseScale * (selected ? 1.07 : 1));
    }

    try {
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      console.warn('[dice-three-renderer] Falha de render WebGL; contexto marcado como perdido.', error);
      this.contextLost = true;
      this.readyState = 'failed';
    }
  }

  public isContextLost(): boolean {
    if (this.contextLost) {
      return true;
    }
    const context = this.renderer?.getContext?.();
    if (!context || typeof context.isContextLost !== 'function') {
      return false;
    }
    const lost = Boolean(context.isContextLost());
    if (lost) {
      this.contextLost = true;
    }
    return lost;
  }

  public dispose(): void {
    for (const state of this.dice.values()) {
      this.disposeMesh(state.mesh);
    }
    this.dice.clear();

    if (this.scene && this.floor) {
      this.scene.remove(this.floor);
      this.disposeMesh(this.floor);
      this.floor = null;
    }
    if (this.floorTexture && typeof this.floorTexture.dispose === 'function') {
      this.floorTexture.dispose();
      this.floorTexture = null;
    }

    if (this.renderer) {
      if (typeof this.renderer.dispose === 'function') {
        this.renderer.dispose();
      }
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.ambientLight = null;
    this.keyLight = null;
    this.raycaster = null;
    this.pointer = null;
    this.projectVector = null;
    this.contextLost = false;
    this.unbindContextEvents();
    this.contextCanvas = null;
    this.readyState = 'idle';
    this.initPromise = null;
  }

  private async ensureReady(): Promise<boolean> {
    if (this.readyState === 'ready') {
      return true;
    }
    if (this.readyState === 'failed') {
      return false;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.readyState = 'pending';
    this.initPromise = import('three')
      .then((mod) => {
        this.three = (mod as Record<string, unknown>).default ?? mod;
        if (!this.canvas) {
          throw new Error('Canvas ausente para inicializar renderer 3D.');
        }
        this.initScene();
        this.readyState = 'ready';
        return true;
      })
      .catch((error) => {
        console.warn('[dice-three-renderer] Falha ao iniciar Three.js.', error);
        this.readyState = 'failed';
        return false;
      });

    return this.initPromise;
  }

  private bindContextEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', this.onWebglContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onWebglContextRestored, false);
  }

  private unbindContextEvents(): void {
    if (!this.contextCanvas) {
      return;
    }
    this.contextCanvas.removeEventListener('webglcontextlost', this.onWebglContextLost, false);
    this.contextCanvas.removeEventListener('webglcontextrestored', this.onWebglContextRestored, false);
  }

  private readonly onWebglContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.readyState = 'failed';
  };

  private readonly onWebglContextRestored = (): void => {
    this.contextLost = false;
    this.readyState = 'idle';
    this.initPromise = null;
  };

  private initScene(): void {
    const THREE = this.three;
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 8.6, 0.001);
    camera.lookAt(0, -1.2, 0);

    const ambient = new THREE.AmbientLight(0xfff4da, 0.88);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff0c9, 0.52);
    key.position.set(-0.8, 7.8, 0.8);
    scene.add(key);

    const floorGeometry = new THREE.PlaneGeometry(10.8, 10.8);
    const carpetTexture = this.createCarpetTexture('moss');
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: carpetTexture,
      roughness: 0.95,
      metalness: 0.02,
      emissive: 0x020402,
      emissiveIntensity: 0.25,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.4, 0);
    scene.add(floor);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ambientLight = ambient;
    this.keyLight = key;
    this.floor = floor;
    this.floorTexture = carpetTexture;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.projectVector = new THREE.Vector3();
    this.updateCameraTopDown(4);
  }

  private resize(): void {
    if (!this.canvas || !this.renderer || !this.camera) {
      return;
    }

    const cssWidth = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const cssHeight = Math.max(1, this.canvas.clientHeight || this.canvas.height);

    const scale = this.qualityPreset === 'quality' ? 0.92 : 0.7;
    const internalWidth = Math.max(240, Math.floor(cssWidth * scale));
    const internalHeight = Math.max(140, Math.floor(cssHeight * scale));

    if (this.canvas.width !== internalWidth) {
      this.canvas.width = internalWidth;
    }
    if (this.canvas.height !== internalHeight) {
      this.canvas.height = internalHeight;
    }

    this.renderer.setSize(internalWidth, internalHeight, false);
    this.camera.aspect = internalWidth / Math.max(1, internalHeight);
    this.camera.updateProjectionMatrix();
  }

  private createDieMesh(roll: RolledDie, dieFaces?: DiceFaceDef[]): DieMeshState {
    const THREE = this.three;
    const geometry = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    const materials = this.createMaterialsForFace(roll.face, roll.faceIndex, dieFaces);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(0, 0, 0);
    this.scene.add(mesh);

    return {
      mesh,
      faceIndex: roll.faceIndex,
      faceId: roll.face.id,
      iconRevision: getDiceFaceIconRevision(roll.face.id),
      inactive: false,
      baseScale: 1,
      fullFaces: Array.isArray(dieFaces) && dieFaces.length >= 6,
    };
  }

  private patchDieMaterials(
    mesh: any,
    face: DiceFaceDef,
    faceIndex: number,
    dieFaces?: DiceFaceDef[],
  ): void {
    const nextMaterials = this.createMaterialsForFace(face, faceIndex, dieFaces);
    const current = Array.isArray(mesh.material) ? (mesh.material as any[]) : [mesh.material];
    for (const material of current) {
      this.disposeMaterial(material);
    }
    mesh.material = nextMaterials;
  }

  private createMaterialsForFace(face: DiceFaceDef, faceIndex: number, dieFaces?: DiceFaceDef[]): any[] {
    const THREE = this.three;

    const baseMaterials = Array.from({ length: 6 }, (_, sideIndex) => {
      const texture = this.createTexture(placeholderFace(sideIndex));
      return new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.76,
        metalness: 0.06,
        emissive: 0x000000,
        emissiveIntensity: 0,
      });
    });

    if (Array.isArray(dieFaces) && dieFaces.length >= 6) {
      for (let index = 0; index < 6; index += 1) {
        const mappedMaterialIndex = faceIndexToMaterialIndex(index);
        const sideFace = dieFaces[index] ?? placeholderFace(index);
        const sideTexture = this.createTexture(sideFace);
        baseMaterials[mappedMaterialIndex] = new THREE.MeshStandardMaterial({
          map: sideTexture,
          color: 0xffffff,
          roughness: 0.72,
          metalness: 0.07,
          emissive: 0x000000,
          emissiveIntensity: 0,
        });
      }
    } else {
      const rollMaterialIndex = faceIndexToMaterialIndex(faceIndex);
      const rollTexture = this.createTexture(face);
      baseMaterials[rollMaterialIndex] = new THREE.MeshStandardMaterial({
        map: rollTexture,
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.07,
        emissive: 0x000000,
        emissiveIntensity: 0,
      });
    }

    return baseMaterials;
  }

  private createTexture(face: DiceFaceDef): any {
    const THREE = this.three;
    const payload = makeDieFaceTexturePayload(face, DIE_FACE_TEXTURE_SIZE);
    const texture = new THREE.DataTexture(
      payload.data,
      payload.width,
      payload.height,
      THREE.RGBAFormat,
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    return texture;
  }

  private updateCameraTopDown(diceCount: number): void {
    if (!this.camera || !this.three) {
      return;
    }
    const clamped = Math.max(1, diceCount);
    this.cameraTargetRadius = clamped >= 10 ? 5.1 : clamped >= 8 ? 4.35 : clamped >= 6 ? 3.9 : clamped >= 4 ? 3.35 : 2.9;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const height = this.cameraTargetRadius / Math.tan(fovRad * 0.5);

    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, Math.max(7.2, height), 0.001);
    this.camera.lookAt(0, -1.25, 0);
    this.camera.updateProjectionMatrix();
  }

  private createCarpetTexture(tone: 'moss' | 'crimson'): any {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const base = tone === 'crimson' ? '#5f101a' : '#1b3c23';
    const shade = tone === 'crimson' ? '#4a0c14' : '#15311c';
    const line = tone === 'crimson' ? '#7d1b27' : '#2a5630';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);

    for (let y = 0; y < 128; y += 2) {
      ctx.fillStyle = (y / 2) % 2 === 0 ? shade : base;
      ctx.fillRect(0, y, 128, 1);
    }

    ctx.globalAlpha = 0.28;
    for (let i = 0; i < 280; i += 1) {
      const x = Math.floor(Math.random() * 128);
      const y = Math.floor(Math.random() * 128);
      ctx.fillStyle = i % 3 === 0 ? line : shade;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    const THREE = this.three;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 5);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  private disposeMesh(mesh: any): void {
    if (!mesh) {
      return;
    }

    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
    }

    const materials = Array.isArray(mesh.material) ? (mesh.material as any[]) : [mesh.material];
    for (const material of materials) {
      this.disposeMaterial(material);
    }
  }

  private disposeMaterial(material: any): void {
    if (!material) {
      return;
    }
    if (material.map && typeof material.map.dispose === 'function') {
      material.map.dispose();
    }
    if (typeof material.dispose === 'function') {
      material.dispose();
    }
  }
}
