import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  FACE_SHADE,
  QUAD_STRIDE,
  type BakedBlock,
  type CameraState,
  type ViewName,
  type Vec3,
} from '@minecraft-schematic-lab/shared';
import { createBlockMaterial, type LayerKind } from './blockMaterial';
import { CHUNK, type ChunkMesh, type WorkerIn, type WorkerOut } from './meshTypes';
import { uploadMipLevels, whiteTextureArray } from './textures';

export interface PickInfo {
  /** Local cell coordinates. */
  pos: Vec3;
  normal: Vec3;
  id: number;
  /** Where the ray enters the block (local coordinates). */
  point: Vec3;
}

/** A moving block drawn on its own (falling sand): palette index, local position of its bottom. */
export interface EntityView {
  id: number;
  state: number;
  pos: Vec3;
}

export interface ViewerCallbacks {
  onHover?(pick: PickInfo | null): void;
  onClick?(pick: PickInfo | null, event: { shift: boolean; alt: boolean }): void;
  /** A right-click without dragging (dragging pans). */
  onUse?(pick: PickInfo | null): void;
  onCamera?(state: CameraState): void;
  onFrame?(): void;
  onProgress?(done: number, total: number): void;
}

export interface LoadedVolume {
  size: Vec3;
  data: Uint16Array;
  models: (BakedBlock | null)[];
  nameIds: Int32Array;
}

const KINDS: LayerKind[] = ['opaque', 'cutout', 'translucent'];

export const VIEW_DIRS: Record<Exclude<ViewName, 'user'>, Vec3> = {
  iso: [1, 0.78, 1],
  iso_nw: [-1, 0.78, -1],
  iso_ne: [1, 0.78, -1],
  iso_sw: [-1, 0.78, 1],
  front: [0, 0.22, 1],
  back: [0, 0.22, -1],
  left: [-1, 0.22, 0],
  right: [1, 0.22, 0],
  top: [0, 1, 0.0001],
};

interface ChunkEntry {
  base: THREE.Mesh[];
  clipped: THREE.Mesh[];
  cy: number;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * The 3D viewport: chunked block meshes built in workers, orbit/pan/zoom with Blender-style
 * shortcuts, voxel picking, a layer cut, and off-screen captures for Claude. Renders only when
 * something changed, so an idle viewer costs nothing.
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  private readonly world = new THREE.Group();
  private readonly helpers = new THREE.Group();
  private readonly entityGroup = new THREE.Group();
  private readonly entities = new Map<
    number,
    { group: THREE.Group; state: number; target: THREE.Vector3; gone: number }
  >();
  private materials: Record<LayerKind, THREE.ShaderMaterial>;
  private atlas: THREE.DataArrayTexture = whiteTextureArray();
  private workers: Worker[] = [];
  private generation = 0;
  private chunks = new Map<string, ChunkEntry>();
  private volume: LoadedVolume | null = null;
  private clipY: number | null = null;
  private needsRender = true;
  private raf = 0;
  private tween: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    tFrom: THREE.Vector3;
    tTo: THREE.Vector3;
    start: number;
    ms: number;
  } | null = null;
  private hoverBox: THREE.LineSegments;
  private selectBox: THREE.LineSegments;
  private grid: THREE.Mesh;
  private pending = 0;
  private total = 0;
  private meshWaiters: (() => void)[] = [];
  private resizeObserver: ResizeObserver;
  private pointer = new THREE.Vector2();
  private pointerDirty = false;
  private downAt: { x: number; y: number; t: number } | null = null;
  private cameraTimer = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly cb: ViewerCallbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.outline = 'none';
    this.renderer.domElement.tabIndex = 0;

    this.persp = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -5000, 5000);
    this.camera = this.persp;
    this.persp.position.set(30, 25, 30);
    this.controls = this.makeControls(this.persp);

    uploadMipLevels(this.renderer, this.atlas);
    this.materials = {
      opaque: createBlockMaterial(this.atlas, 'opaque'),
      cutout: createBlockMaterial(this.atlas, 'cutout'),
      translucent: createBlockMaterial(this.atlas, 'translucent'),
    };

    this.scene.add(this.world, this.helpers, this.entityGroup);
    this.hoverBox = this.boxLines(0xffffff, 0.55);
    this.selectBox = this.boxLines(0x0a84ff, 1);
    this.hoverBox.visible = false;
    this.selectBox.visible = false;
    this.helpers.add(this.hoverBox, this.selectBox);
    this.grid = this.makeGrid();
    this.scene.add(this.grid);

    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerOut>) => this.onWorker(e.data);
      this.workers.push(w);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPointer();
    this.loop();
  }

  // ------------------------------------------------------------------ setup helpers

  private makeControls(cam: THREE.Camera): OrbitControls {
    const prevTarget = this.controls?.target.clone();
    this.controls?.dispose();
    const c = new OrbitControls(cam, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.rotateSpeed = 0.8;
    c.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.maxPolarAngle = Math.PI * 0.995;
    if (prevTarget) c.target.copy(prevTarget);
    c.addEventListener('change', () => {
      this.invalidate();
      this.scheduleCameraReport();
    });
    c.addEventListener('start', () => (this.tween = null));
    return c;
  }

  private boxLines(color: number, opacity: number): THREE.LineSegments {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 10;
    return lines;
  }

  private makeGrid(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0.5, 0.55, 0.62) },
        uRadius: { value: 100 },
        uCenter: { value: new THREE.Vector2() },
      },
      vertexShader:
        'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uColor; uniform float uRadius; uniform vec2 uCenter; varying vec3 vP;
        float line(float w){ vec2 c = vP.xz / w; vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){ float d = length(vP.xz - uCenter) / uRadius; float fade = clamp(1.0 - d, 0.0, 1.0);
          float a = max(line(1.0) * 0.18, line(16.0) * 0.45) * fade * fade; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }`,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    mesh.renderOrder = -1;
    return mesh;
  }

  setTheme(dark: boolean): void {
    const g = this.grid.material as THREE.ShaderMaterial;
    (g.uniforms.uColor?.value as THREE.Color).set(dark ? 0x8d97a8 : 0x5b6575);
    for (const m of Object.values(this.materials))
      (m.uniforms.uFogColor?.value as THREE.Color).set(dark ? 0x161a22 : 0xdfe8f4);
    this.invalidate();
  }

  setGridVisible(v: boolean): void {
    this.grid.visible = v;
    this.invalidate();
  }

  setTextures(atlas: THREE.DataArrayTexture | null): void {
    const tex = atlas ?? whiteTextureArray();
    if (this.atlas !== tex) this.atlas.dispose();
    this.atlas = tex;
    uploadMipLevels(this.renderer, tex);
    for (const m of Object.values(this.materials))
      if (m.uniforms.uAtlas) m.uniforms.uAtlas.value = tex;
    this.invalidate();
  }

  // ------------------------------------------------------------------ data & meshing

  /** Replace the build; resolves once every chunk is meshed. */
  load(volume: LoadedVolume, keepCamera: boolean): Promise<void> {
    this.volume = volume;
    this.generation++;
    for (const id of [...this.entities.keys()]) this.disposeEntity(id);
    this.liveDirty.clear();
    this.liveInFlight = 0;
    this.modelCount = volume.models.length;
    this.clearChunks();
    const [sx, sy, sz] = volume.size;
    for (const w of this.workers) {
      const msg: WorkerIn = {
        type: 'init',
        generation: this.generation,
        size: volume.size,
        data: volume.data,
        models: volume.models,
        nameIds: volume.nameIds,
      };
      w.postMessage(msg);
    }
    const radius = Math.max(sx, sz) * 2 + 32;
    this.grid.scale.set(radius * 2, 1, radius * 2);
    this.grid.position.set(sx / 2, 0.001, sz / 2);
    const gm = this.grid.material as THREE.ShaderMaterial;
    (gm.uniforms.uCenter?.value as THREE.Vector2).set(sx / 2, sz / 2);
    if (gm.uniforms.uRadius) gm.uniforms.uRadius.value = radius;
    const far = Math.max(sx, sy, sz) * 3 + 200;
    for (const m of Object.values(this.materials))
      (m.uniforms.uFog?.value as THREE.Vector2).set(far * 0.45, far);
    this.persp.far = far * 2;
    this.persp.updateProjectionMatrix();
    if (!keepCamera) this.frameView('iso', null, false);
    const chunks = this.occupiedChunks();
    // A layer cut that was active before the reload needs its cut layer re-meshed too.
    return this.mesh(chunks, null).then(() => this.remeshClipLayer());
  }

  get loadedVolume(): LoadedVolume | null {
    return this.volume;
  }

  private occupiedChunks(): [number, number, number][] {
    const v = this.volume;
    if (!v) return [];
    const [sx, sy, sz] = v.size;
    const ncx = Math.ceil(sx / CHUNK);
    const ncy = Math.ceil(sy / CHUNK);
    const ncz = Math.ceil(sz / CHUNK);
    const occ = new Uint8Array(ncx * ncy * ncz);
    let i = 0;
    for (let y = 0; y < sy; y++) {
      const cy = (y / CHUNK) | 0;
      for (let z = 0; z < sz; z++) {
        const cz = (z / CHUNK) | 0;
        for (let x = 0; x < sx; x++, i++) {
          if (v.data[i] !== 0) occ[((x / CHUNK) | 0) + ncx * (cz + ncz * cy)] = 1;
        }
      }
    }
    const out: [number, number, number][] = [];
    for (let cy = 0; cy < ncy; cy++)
      for (let cz = 0; cz < ncz; cz++)
        for (let cx = 0; cx < ncx; cx++)
          if (occ[cx + ncx * (cz + ncz * cy)]) out.push([cx, cy, cz]);
    const t = this.controls.target;
    out.sort((a, b) => {
      const da = (a[0] * CHUNK - t.x) ** 2 + (a[1] * CHUNK - t.y) ** 2 + (a[2] * CHUNK - t.z) ** 2;
      const db = (b[0] * CHUNK - t.x) ** 2 + (b[1] * CHUNK - t.y) ** 2 + (b[2] * CHUNK - t.z) ** 2;
      return da - db;
    });
    return out;
  }

  private mesh(chunks: [number, number, number][], clipY: number | null): Promise<void> {
    if (chunks.length === 0) {
      this.invalidate();
      return Promise.resolve();
    }
    this.pending += chunks.length;
    this.total += chunks.length;
    const parts: [number, number, number][][] = this.workers.map(() => []);
    chunks.forEach((c, i) => (parts[i % parts.length] as [number, number, number][]).push(c));
    // Small batches keep results streaming in nearest-first.
    parts.forEach((list, wi) => {
      for (let i = 0; i < list.length; i += 4) {
        const msg: WorkerIn = {
          type: 'mesh',
          generation: this.generation,
          chunks: list.slice(i, i + 4),
          clipY,
        };
        (this.workers[wi] as Worker).postMessage(msg);
      }
    });
    return new Promise((resolve) => this.meshWaiters.push(resolve));
  }

  // ------------------------------------------------------------------ live updates

  private liveDirty = new Set<string>();
  private liveInFlight = 0;
  /** Palette models the mesher workers have (the palette only grows while a build is loaded). */
  private modelCount = 0;

  /**
   * Change cells in place (the redstone simulation): `cells` holds pairs of (cell index, palette
   * index); `models` is the full palette, possibly longer than before. Only the chunks touched
   * (and their neighbours across a border, for culling and shading) are meshed again, quietly
   * and at most one batch at a time, so a busy circuit can't flood the workers.
   */
  patch(cells: Uint32Array, models: (BakedBlock | null)[], nameIds: Int32Array): void {
    const v = this.volume;
    if (!v || cells.length === 0) return;
    const from = this.modelCount;
    this.modelCount = models.length;
    v.models = models;
    v.nameIds = nameIds;
    const [sx, , sz] = v.size;
    for (let k = 0; k < cells.length; k += 2) {
      const i = cells[k] as number;
      v.data[i] = cells[k + 1] as number;
      const x = i % sx;
      const t = (i - x) / sx;
      const z = t % sz;
      const y = (t - z) / sz;
      const cx = (x / CHUNK) | 0;
      const cy = (y / CHUNK) | 0;
      const cz = (z / CHUNK) | 0;
      this.liveDirty.add(`${cx},${cy},${cz}`);
      const lx = x % CHUNK;
      const ly = y % CHUNK;
      const lz = z % CHUNK;
      if (lx === 0 && cx > 0) this.liveDirty.add(`${cx - 1},${cy},${cz}`);
      if (lx === CHUNK - 1) this.liveDirty.add(`${cx + 1},${cy},${cz}`);
      if (ly === 0 && cy > 0) this.liveDirty.add(`${cx},${cy - 1},${cz}`);
      if (ly === CHUNK - 1) this.liveDirty.add(`${cx},${cy + 1},${cz}`);
      if (lz === 0 && cz > 0) this.liveDirty.add(`${cx},${cy},${cz - 1}`);
      if (lz === CHUNK - 1) this.liveDirty.add(`${cx},${cy},${cz + 1}`);
    }
    const msg: WorkerIn = {
      type: 'patch',
      generation: this.generation,
      cells,
      from,
      models: models.slice(from),
      nameIds,
    };
    for (const w of this.workers) w.postMessage(msg);
    this.flushLive();
  }

  private flushLive(): void {
    if (this.liveInFlight > 0 || this.liveDirty.size === 0 || !this.volume) return;
    const [sx, sy, sz] = this.volume.size;
    const chunks = [...this.liveDirty]
      .map((k) => k.split(',').map(Number) as [number, number, number])
      .filter(([x, y, z]) => x * CHUNK < sx && y * CHUNK < sy && z * CHUNK < sz);
    this.liveDirty.clear();
    const clipLayer = this.clipY !== null ? Math.floor(this.clipY / CHUNK) : null;
    const jobs: { chunks: [number, number, number][]; clipY: number | null }[] = [
      { chunks, clipY: null },
    ];
    if (clipLayer !== null)
      jobs.push({ chunks: chunks.filter((c) => c[1] === clipLayer), clipY: this.clipY });
    let w = 0;
    for (const job of jobs) {
      for (const c of job.chunks) {
        this.liveInFlight++;
        const msg: WorkerIn = {
          type: 'mesh',
          generation: this.generation,
          chunks: [c],
          clipY: job.clipY,
          live: true,
        };
        (this.workers[w++ % this.workers.length] as Worker).postMessage(msg);
      }
    }
  }

  private onWorker(msg: WorkerOut): void {
    if (msg.generation !== this.generation || msg.type !== 'chunk') return;
    if (msg.live) {
      this.addChunk(msg.mesh, msg.clipY);
      this.liveInFlight = Math.max(0, this.liveInFlight - 1);
      if (this.liveInFlight === 0) this.flushLive();
      this.invalidate();
      return;
    }
    this.addChunk(msg.mesh, msg.clipY);
    this.pending--;
    this.cb.onProgress?.(this.total - this.pending, this.total);
    if (this.pending <= 0) {
      this.pending = 0;
      this.total = 0;
      for (const w of this.meshWaiters.splice(0)) w();
    }
    this.invalidate();
  }

  private addChunk(mesh: ChunkMesh, clipY: number | null): void {
    let entry = this.chunks.get(mesh.key);
    if (!entry) {
      entry = { base: [], clipped: [], cy: mesh.cy };
      this.chunks.set(mesh.key, entry);
    }
    const target = clipY === null ? entry.base : entry.clipped;
    for (const m of target.splice(0)) {
      m.geometry.dispose();
      this.world.remove(m);
    }
    mesh.layers.forEach((buf, li) => {
      if (!buf) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
      geo.setAttribute('uvw', new THREE.BufferAttribute(buf.uvw, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(buf.colors, 3, true));
      geo.setIndex(new THREE.BufferAttribute(buf.indices, 1));
      const c = new THREE.Vector3(
        (mesh.cx + 0.5) * CHUNK,
        (mesh.cy + 0.5) * CHUNK,
        (mesh.cz + 0.5) * CHUNK,
      );
      geo.boundingSphere = new THREE.Sphere(c, CHUNK * 0.9);
      const m = new THREE.Mesh(geo, this.materials[KINDS[li] as LayerKind]);
      m.renderOrder = li;
      m.matrixAutoUpdate = false;
      this.world.add(m);
      target.push(m);
    });
    this.applyClipVisibility();
  }

  private clearChunks(): void {
    for (const e of this.chunks.values()) {
      for (const m of [...e.base, ...e.clipped]) {
        m.geometry.dispose();
        this.world.remove(m);
      }
    }
    this.chunks.clear();
    this.pending = 0;
    this.total = 0;
    for (const w of this.meshWaiters.splice(0)) w();
  }

  /** Show only y <= clipY (local), like Litematica's layer range. null shows everything. */
  setClipY(clipY: number | null): Promise<void> {
    if (clipY === this.clipY) return Promise.resolve();
    this.clipY = clipY;
    for (const e of this.chunks.values()) {
      for (const m of e.clipped.splice(0)) {
        m.geometry.dispose();
        this.world.remove(m);
      }
    }
    this.applyClipVisibility();
    return this.remeshClipLayer();
  }

  /** Mesh the chunk layer the cut passes through with the cut applied (top faces at the cut). */
  private remeshClipLayer(): Promise<void> {
    const clipY = this.clipY;
    if (clipY === null || !this.volume) return Promise.resolve();
    const cy = Math.floor(clipY / CHUNK);
    const layer = [...this.chunks.entries()]
      .filter(([, e]) => e.cy === cy && e.clipped.length === 0)
      .map(([k]) => k.split(',').map(Number) as [number, number, number]);
    return this.mesh(layer, clipY);
  }

  get clip(): number | null {
    return this.clipY;
  }

  private applyClipVisibility(): void {
    const clip = this.clipY;
    for (const e of this.chunks.values()) {
      const y0 = e.cy * CHUNK;
      const cutHere = clip !== null && clip >= y0 && clip < y0 + CHUNK;
      const above = clip !== null && y0 > clip;
      for (const m of e.base) m.visible = !above && !(cutHere && e.clipped.length > 0);
      for (const m of e.clipped) m.visible = cutHere;
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ camera

  private boundsOf(region: { from: Vec3; to: Vec3 } | null): THREE.Box3 {
    if (region) {
      return new THREE.Box3(
        new THREE.Vector3(
          Math.min(region.from[0], region.to[0]),
          Math.min(region.from[1], region.to[1]),
          Math.min(region.from[2], region.to[2]),
        ),
        new THREE.Vector3(
          Math.max(region.from[0], region.to[0]) + 1,
          Math.max(region.from[1], region.to[1]) + 1,
          Math.max(region.from[2], region.to[2]) + 1,
        ),
      );
    }
    const s = this.volume?.size ?? [16, 16, 16];
    const top = this.clipY !== null ? Math.min(s[1], this.clipY + 1) : s[1];
    return new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s[0], top, s[2]));
  }

  /**
   * Camera position + target that frames a box from a direction: projects the 8 corners onto
   * the view plane so the box fills the frame (a bounding sphere leaves too much empty space).
   */
  private fit(
    dir: Vec3,
    box: THREE.Box3,
    aspect = 1,
    fov = 40,
  ): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const back = new THREE.Vector3(...dir).normalize();
    const forward = back.clone().negate();
    const worldUp =
      Math.abs(forward.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const tv = Math.tan((fov * Math.PI) / 360);
    const th = tv * aspect;
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    // Centre the box's projection on screen.
    const center = box.getCenter(new THREE.Vector3());
    let rMin = Infinity;
    let rMax = -Infinity;
    let uMin = Infinity;
    let uMax = -Infinity;
    for (const c of corners) {
      const d = c.clone().sub(center);
      rMin = Math.min(rMin, d.dot(right));
      rMax = Math.max(rMax, d.dot(right));
      uMin = Math.min(uMin, d.dot(up));
      uMax = Math.max(uMax, d.dot(up));
    }
    const target = center
      .clone()
      .addScaledVector(right, (rMin + rMax) / 2)
      .addScaledVector(up, (uMin + uMax) / 2);
    let dist = 1;
    for (const c of corners) {
      const d = c.clone().sub(target);
      const cr = Math.abs(d.dot(right));
      const cu = Math.abs(d.dot(up));
      const cf = d.dot(forward);
      dist = Math.max(dist, cr / th - cf, cu / tv - cf);
    }
    dist *= 1.06;
    return { pos: target.clone().addScaledVector(back, dist), target };
  }

  frameView(
    view: Exclude<ViewName, 'user'>,
    region: { from: Vec3; to: Vec3 } | null,
    animate = true,
  ): void {
    const box = this.boundsOf(region);
    const { pos, target } = this.fit(VIEW_DIRS[view], box, this.aspect, this.persp.fov);
    this.moveCamera(pos, target, animate);
  }

  /** Keep the direction, frame the region (F / Home). */
  frameRegion(region: { from: Vec3; to: Vec3 } | null, animate = true): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const box = this.boundsOf(region);
    const { pos, target } = this.fit([dir.x, dir.y, dir.z], box, this.aspect, this.persp.fov);
    this.moveCamera(pos, target, animate);
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean): void {
    if (this.camera === this.ortho) this.syncOrthoZoom(pos.distanceTo(target));
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.invalidate();
      return;
    }
    this.tween = {
      from: this.camera.position.clone(),
      to: pos,
      tFrom: this.controls.target.clone(),
      tTo: target,
      start: performance.now(),
      ms: 420,
    };
    this.invalidate();
  }

  /** Orbit around the target by angles (numpad 4/6/8/2). */
  orbit(dYaw: number, dPitch: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += dYaw;
    sph.phi = Math.min(Math.PI - 0.01, Math.max(0.01, sph.phi + dPitch));
    this.moveCamera(
      this.controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph)),
      this.controls.target.clone(),
      true,
    );
  }

  setOrtho(on: boolean): void {
    if ((this.camera === this.ortho) === on) return;
    const from = this.camera;
    const to = on ? this.ortho : this.persp;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    if (on) this.syncOrthoZoom(from.position.distanceTo(this.controls.target));
    this.controls = this.makeControls(to);
    this.resize();
  }

  get isOrtho(): boolean {
    return this.camera === this.ortho;
  }

  private syncOrthoZoom(distance: number): void {
    const h = 2 * distance * Math.tan((this.persp.fov * Math.PI) / 360);
    this.ortho.top = h / 2;
    this.ortho.bottom = -h / 2;
    this.ortho.left = (-h / 2) * this.aspect;
    this.ortho.right = (h / 2) * this.aspect;
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
  }

  /** Make a block the orbit pivot (double-click). */
  pivotOn(pos: Vec3): void {
    const t = new THREE.Vector3(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
    const shift = t.clone().sub(this.controls.target);
    this.moveCamera(this.camera.position.clone().add(shift), t, true);
  }

  cameraState(): CameraState {
    const p = this.camera.position;
    const t = this.controls.target;
    return {
      position: [p.x, p.y, p.z],
      target: [t.x, t.y, t.z],
      fov: this.persp.fov,
      ortho: this.isOrtho,
    };
  }

  /** Camera's horizontal yaw/pitch, for the navigation gizmo. */
  get quaternion(): THREE.Quaternion {
    return this.camera.quaternion;
  }

  private scheduleCameraReport(): void {
    clearTimeout(this.cameraTimer);
    this.cameraTimer = window.setTimeout(() => this.cb.onCamera?.(this.cameraState()), 400);
  }

  // ------------------------------------------------------------------ picking

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      this.pointerDirty = true;
      this.invalidate();
    });
    el.addEventListener('pointerleave', () => {
      this.hoverBox.visible = false;
      this.cb.onHover?.(null);
      this.invalidate();
    });
    el.addEventListener(
      'pointerdown',
      (e) => (this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() }),
    );
    el.addEventListener('pointerup', (e) => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || (e.button !== 0 && e.button !== 2)) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 600) return;
      const pick = this.pickAt(this.pointer);
      if (e.button === 2) this.cb.onUse?.(pick);
      else this.cb.onClick?.(pick, { shift: e.shiftKey, alt: e.altKey });
    });
    el.addEventListener('dblclick', () => {
      const hit = this.pickAt(this.pointer);
      if (hit) this.pivotOn(hit.pos);
    });
  }

  /** Voxel DDA along the mouse ray: first visible block. */
  pickAt(ndc: THREE.Vector2): PickInfo | null {
    const v = this.volume;
    if (!v) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...v.size));
    // From the camera when it is inside the build's box (zoomed in close), else where the ray
    // enters it (intersectBox gives the exit point for a ray starting inside).
    const entry = box.containsPoint(ray.ray.origin)
      ? ray.ray.origin.clone()
      : ray.ray.intersectBox(box, new THREE.Vector3());
    if (!entry) return null;
    const dir = ray.ray.direction;
    const p = entry.clone().addScaledVector(dir, 1e-4);
    const cell = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    const step = [Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z)];
    const tDelta = [Math.abs(1 / dir.x), Math.abs(1 / dir.y), Math.abs(1 / dir.z)];
    const comp = [p.x, p.y, p.z];
    const tMax = [0, 1, 2].map((a) => {
      const s = step[a] as number;
      const c = cell[a] as number;
      if (s === 0) return Infinity;
      return ((s > 0 ? c + 1 : c) - (comp[a] as number)) / (dir.getComponent(a) as number);
    });
    let normal: Vec3 = [0, 0, 0];
    const [sx, sy, sz] = v.size;
    const clip = this.clipY ?? Infinity;
    let t = 0;
    for (let i = 0; i < 4096; i++) {
      const [x, y, z] = cell as [number, number, number];
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return null;
      if (y <= clip) {
        const id = v.data[x + sx * (z + sz * y)] as number;
        if (id !== 0 && v.models[id]) {
          const point: Vec3 = [p.x + dir.x * t, p.y + dir.y * t, p.z + dir.z * t];
          return { pos: [x, y, z], normal, id, point };
        }
      }
      const a =
        (tMax[0] as number) < (tMax[1] as number)
          ? (tMax[0] as number) < (tMax[2] as number)
            ? 0
            : 2
          : (tMax[1] as number) < (tMax[2] as number)
            ? 1
            : 2;
      (cell[a] as number) += step[a] as number;
      t = tMax[a] as number;
      (tMax[a] as number) += tDelta[a] as number;
      normal = [0, 0, 0];
      normal[a] = -(step[a] as number);
    }
    return null;
  }

  setHover(pos: Vec3 | null): void {
    this.hoverBox.visible = !!pos;
    if (pos) this.hoverBox.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
    this.invalidate();
  }

  /** Outline a block or region (local coords). */
  setSelection(region: { from: Vec3; to: Vec3 } | null): void {
    this.selectBox.visible = !!region;
    if (region) {
      const b = this.boundsOf(region);
      const size = b.getSize(new THREE.Vector3());
      this.selectBox.scale.set(size.x + 0.02, size.y + 0.02, size.z + 0.02);
      this.selectBox.position.copy(b.getCenter(new THREE.Vector3()));
    }
    this.invalidate();
  }

  /** Screen position (CSS px) of a local point, or null when behind the camera. */
  project(p: Vec3): { x: number; y: number } | null {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    if (v.z > 1) return null;
    const r = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight };
  }

  // ------------------------------------------------------------------ moving blocks

  /**
   * Blocks that move on their own (falling sand and gravel), drawn as single-block meshes that
   * glide to each new position. One that lands lingers a moment, until its block is meshed.
   */
  setEntities(list: EntityView[], models: readonly (BakedBlock | null)[]): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const e of list) {
      seen.add(e.id);
      let m = this.entities.get(e.id);
      if (m && m.state !== e.state) {
        this.disposeEntity(e.id);
        m = undefined;
      }
      if (!m) {
        const group = this.blockMesh(models[e.state] ?? null);
        group.position.set(e.pos[0], e.pos[1], e.pos[2]);
        m = { group, state: e.state, target: new THREE.Vector3(), gone: 0 };
        this.entities.set(e.id, m);
        this.entityGroup.add(group);
      }
      m.target.set(e.pos[0], e.pos[1], e.pos[2]);
      m.gone = 0;
    }
    for (const [id, m] of this.entities) if (!seen.has(id) && !m.gone) m.gone = now;
    this.invalidate();
  }

  private disposeEntity(id: number): void {
    const m = this.entities.get(id);
    if (!m) return;
    this.entityGroup.remove(m.group);
    for (const c of m.group.children) (c as THREE.Mesh).geometry.dispose();
    this.entities.delete(id);
  }

  /** One block's model as meshes (face shading, no ambient occlusion), its origin at a corner. */
  private blockMesh(model: BakedBlock | null): THREE.Group {
    const group = new THREE.Group();
    const q = model?.v[0]?.q;
    if (!q) return group;
    const layers: { pos: number[]; uvw: number[]; col: number[]; idx: number[] }[] = [0, 1, 2].map(
      () => ({ pos: [], uvw: [], col: [], idx: [] }),
    );
    for (let o = 0; o < q.length; o += QUAD_STRIDE) {
      const L = layers[q[o + 24] as number];
      if (!L) continue;
      const dir = q[o + 22] as number;
      const tint = q[o + 23] as number;
      const shade = dir >= 0 ? (FACE_SHADE[dir] as number) : 1;
      const rgb = tint >= 0 ? [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255] : [255, 255, 255];
      const base = L.pos.length / 3;
      for (let k = 0; k < 4; k++) {
        L.pos.push(q[o + k * 3] as number, q[o + k * 3 + 1] as number, q[o + k * 3 + 2] as number);
        L.uvw.push(q[o + 12 + k * 2] as number, q[o + 13 + k * 2] as number, q[o + 20] as number);
        L.col.push(...rgb.map((c) => Math.round((c as number) * shade)));
      }
      L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    layers.forEach((L, li) => {
      if (!L.idx.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
      geo.setAttribute('uvw', new THREE.Float32BufferAttribute(L.uvw, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(L.col), 3, true));
      geo.setIndex(L.idx);
      const mesh = new THREE.Mesh(geo, this.materials[KINDS[li] as LayerKind]);
      mesh.renderOrder = li;
      group.add(mesh);
    });
    return group;
  }

  /** Glide moving blocks toward their latest position; drop the ones gone a while. */
  private animateEntities(now: number): boolean {
    let moving = false;
    for (const [id, m] of this.entities) {
      if (m.gone && now - m.gone > 150) {
        this.disposeEntity(id);
        moving = true;
        continue;
      }
      const p = m.group.position;
      if (p.distanceToSquared(m.target) > 1e-6) {
        p.lerp(m.target, 0.45);
        moving = true;
      }
      m.group.visible = this.clipY === null || p.y <= this.clipY + 0.5;
    }
    return moving || this.entities.size > 0;
  }

  // ------------------------------------------------------------------ render loop

  private get aspect(): number {
    const el = this.renderer.domElement;
    return Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, true);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const hh = (this.ortho.top - this.ortho.bottom) / 2;
    this.ortho.left = -hh * (w / h);
    this.ortho.right = hh * (w / h);
    this.ortho.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.start) / this.tween.ms);
      const k = easeInOut(t);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, k);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, k);
      if (t >= 1) {
        this.tween = null;
        this.scheduleCameraReport();
      }
      this.needsRender = true;
    }
    if (this.controls.update()) this.needsRender = true;
    if (this.entities.size && this.animateEntities(performance.now())) this.needsRender = true;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      const hit = this.pickAt(this.pointer);
      this.setHover(hit?.pos ?? null);
      this.cb.onHover?.(hit);
    }
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
    this.cb.onFrame?.();
  };

  /** Resolve once all queued meshing has finished. */
  whenMeshed(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.meshWaiters.push(resolve));
  }

  // ------------------------------------------------------------------ captures for Claude

  /**
   * Render a view off-screen at size×size and return the pixels on a canvas (with pins drawn by
   * the caller). Uses its own perspective camera so the user's view is untouched.
   */
  renderView(
    view: ViewName,
    size: number,
    region: { from: Vec3; to: Vec3 } | null,
    user: CameraState | null,
  ): { canvas: HTMLCanvasElement; project: (p: Vec3) => { x: number; y: number } | null } {
    const cam = new THREE.PerspectiveCamera(this.persp.fov, 1, 0.1, this.persp.far);
    if (view === 'user') {
      const s = user ?? this.cameraState();
      cam.position.set(...s.position);
      cam.lookAt(new THREE.Vector3(...s.target));
    } else {
      const { pos, target } = this.fit(VIEW_DIRS[view], this.boundsOf(region), 1, cam.fov);
      cam.position.copy(pos);
      cam.lookAt(target);
    }
    cam.updateMatrixWorld();
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    const hv = this.hoverBox.visible;
    const sv = this.selectBox.visible;
    this.hoverBox.visible = false;
    this.selectBox.visible = false;
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const pixels = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.hoverBox.visible = hv;
    this.selectBox.visible = sv;
    this.invalidate();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return {
      canvas,
      project: (p) => {
        const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
        if (v.z > 1) return null;
        return { x: ((v.x + 1) / 2) * size, y: ((1 - v.y) / 2) * size };
      },
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const w of this.workers) w.terminate();
    this.clearChunks();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
