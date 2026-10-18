import type {
  AssetManifest,
  BakedBlock,
  BuildHeader,
  CaptureRequest,
  ServerEvent,
  Vec3,
  ViewName,
} from '@minecraft-schematic-lab/shared';
import { blockShape, colorFor } from '@minecraft-schematic-lab/shared';
import { api, connectEvents } from './api';
import { loadTextureArray } from './engine/textures';
import { Viewer, type PickInfo } from './engine/Viewer';
import { fmt, t } from './i18n';
import { SimController } from './sim/simController';
import { useApp } from './store';

const VIEW_LABEL: Record<ViewName, string> = {
  iso: 'front-right, from south-east',
  iso_nw: 'back-left, from north-west',
  iso_ne: 'back-right, from north-east',
  iso_sw: 'front-left, from south-west',
  front: 'front (south side)',
  back: 'back (north side)',
  left: 'left (west side)',
  right: 'right (east side)',
  top: 'top (north is up)',
  user: "the user's current view",
};

function hexToInt(c: string): number {
  if (c.startsWith('#')) return Number.parseInt(c.slice(1), 16);
  const m = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(c);
  if (!m) return 0x888888;
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

/** Plain coloured boxes when the game textures can't be loaded (offline, first run without internet). */
function fallbackModel(state: string): BakedBlock {
  const shape = blockShape(state);
  const color = hexToInt(colorFor(state));
  const h =
    shape === 'slab'
      ? 0.5
      : shape === 'flat'
        ? 1 / 16
        : shape === 'low'
          ? 2 / 16
          : shape === 'small'
            ? 0.6
            : 1;
  const w = shape === 'thin' ? 0.3 : shape === 'small' ? 0.25 : 1;
  const a = (1 - w) / 2;
  const b = a + w;
  const glass = shape === 'glass';
  const faces: [number[], number, number][] = [
    [[a, 0, b, a, 0, a, b, 0, a, b, 0, b], 0, 0],
    [[a, h, a, a, h, b, b, h, b, b, h, a], h === 1 && w === 1 ? 1 : -1, 1],
    [[b, h, a, b, 0, a, a, 0, a, a, h, a], w === 1 ? 2 : -1, 2],
    [[a, h, b, a, 0, b, b, 0, b, b, h, b], w === 1 ? 3 : -1, 3],
    [[a, h, a, a, 0, a, a, 0, b, a, h, b], w === 1 ? 4 : -1, 4],
    [[b, h, b, b, 0, b, b, 0, a, b, h, a], w === 1 ? 5 : -1, 5],
  ];
  const q: number[] = [];
  for (const [p, cull, dir] of faces)
    q.push(...p, 0, 0, 0, 1, 1, 1, 1, 0, 0, cull, dir, color, glass ? 2 : 0, 1);
  return { v: [{ w: 1, q }], full: shape === 'full', self: glass };
}

const BASE_TITLE = document.title;

class Controller {
  viewer: Viewer | null = null;
  readonly sim = new SimController({
    get viewer() {
      return controller.viewer;
    },
    models: (states) => this.bakedFor(states),
    warm: (states) => void this.bakedFor(states).catch(() => undefined),
  });

  /** Textures currently loaded (for block icons). */
  get assets(): { version: string | null; manifest: AssetManifest | null } {
    return { version: this.assetVersion, manifest: this.manifest };
  }

  modelOf(state: string): BakedBlock | null {
    return (this.assetVersion && this.models.get(this.assetVersion)?.get(state)) || null;
  }

  /** Block counts of the loaded build, aggregated per block (doors once, double slabs twice). */
  materialCounts(): { name: string; state: string; count: number }[] {
    const vol = this.viewer?.loadedVolume;
    const h = useApp.getState().header;
    if (!vol || !h) return [];
    const perId = new Uint32Array(h.palette.length);
    for (let i = 0; i < vol.data.length; i++) (perId[vol.data[i] as number] as number)++;
    const totals = new Map<string, { state: string; count: number }>();
    h.palette.forEach((state, id) => {
      const n = perId[id] as number;
      if (id === 0 || n === 0) return;
      if (/half=upper/.test(state) && !/_stairs|_trapdoor/.test(state)) return;
      if (/part=head/.test(state)) return;
      const name = state
        .replace(/^minecraft:/, '')
        .replace(/\[.*$/, '')
        .replace(/_wall_(sign|banner|torch|head|skull|fan)$/, '_$1')
        .replace(/^wall_torch$/, 'torch');
      const k = /type=double/.test(state) && name.endsWith('_slab') ? 2 : 1;
      const cur = totals.get(name);
      totals.set(name, { state: cur?.state ?? state, count: (cur?.count ?? 0) + n * k });
    });
    return [...totals.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count);
  }
  private manifest: AssetManifest | null = null;
  private assetVersion: string | null = null;
  private models = new Map<string, Map<string, BakedBlock>>();
  private loadedBuildId: string | null = null;
  private loadingBuildId: string | null = null;
  private loadPromise: Promise<void> | null = null;
  private stopEvents: (() => void) | null = null;
  private projectId: string | null = null;
  private selectionAnchor: Vec3 | null = null;

  attach(container: HTMLElement): void {
    if (this.viewer) return;
    const s = useApp.getState;
    this.viewer = new Viewer(container, {
      onHover: (hit) => this.onHover(hit),
      onClick: (hit, e) => this.onClick(hit, e.shift),
      onCamera: (camera) => {
        const id = s().clientId;
        if (id) void api.clientState(id, { camera });
      },
      onProgress: (done, total) => s().set({ meshProgress: done >= total ? null : [done, total] }),
      onFrame: () => this.frameListeners.forEach((f) => f()),
    });
    this.viewer.setTheme(s().dark);
    this.viewer.setGridVisible(s().grid);
    const h = s().header;
    if (h) void this.loadBuild(h, true);
  }

  readonly frameListeners = new Set<() => void>();

  start(): void {
    if (this.stopEvents) return;
    const s = useApp.getState;
    this.stopEvents = connectEvents(
      (e) => void this.onEvent(e),
      (connected) => {
        s().set({ connected });
        if (connected) void this.refreshAll();
      },
    );
    document.addEventListener('visibilitychange', () => {
      const id = s().clientId;
      if (id) void api.clientState(id, { visible: document.visibilityState === 'visible' });
      if (document.visibilityState === 'visible') document.title = BASE_TITLE;
    });
    void api
      .versions()
      .then((versions) => s().set({ versions }))
      .catch(() => undefined);
  }

  async refreshAll(): Promise<void> {
    const s = useApp.getState();
    const [header, feedback, projects] = await Promise.all([
      api.build().catch(() => null),
      api.feedback().catch(() => []),
      api.projects().catch(() => ({ current: null, projects: [] })),
    ]);
    s.set({ feedback, projects: projects.projects });
    if (header) {
      void this.refreshHistory();
      if (header.buildId !== this.loadedBuildId) await this.loadBuild(header, false);
    } else {
      useApp.getState().set({ header: null });
    }
  }

  async refreshHistory(): Promise<void> {
    useApp.getState().set({ history: await api.history().catch(() => []) });
  }

  private async onEvent(e: ServerEvent): Promise<void> {
    const s = useApp.getState();
    switch (e.type) {
      case 'hello':
        s.set({ clientId: e.clientId });
        break;
      case 'compiling':
        s.set({ compiling: e.label, buildErrors: null });
        break;
      case 'build-error':
        s.set({ compiling: null, buildErrors: e.errors });
        break;
      case 'build': {
        s.set({ compiling: null, buildErrors: null });
        if (!e.buildId) {
          s.set({ header: null });
          this.loadedBuildId = null;
          break;
        }
        const header = await api.build();
        if (header) {
          await this.loadBuild(header, e.projectId === this.projectId);
          s.toast(`${t.updated} · v${header.n}`, 'success');
          // Claude reuses this tab: mark it when the change lands while the user is elsewhere.
          if (document.visibilityState === 'hidden') document.title = `● ${BASE_TITLE}`;
        }
        void this.refreshHistory();
        s.set({ feedback: await api.feedback().catch(() => s.feedback) });
        break;
      }
      case 'feedback':
        s.set({ feedback: e.items });
        break;
      case 'projects':
        s.set({
          projects: (await api.projects().catch(() => ({ projects: s.projects }))).projects,
        });
        break;
      case 'assets':
        if (e.version === this.wantedAssetVersion && e.state === 'loading') {
          s.set({ assetMessage: e.message ?? fmt(t.texturesLoading, { v: e.version }) });
        }
        break;
      case 'capture':
        await this.capture(e.request);
        break;
      case 'focus':
        this.focus(e.from, e.to, e.message);
        break;
      case 'sim':
        if (e.buildId === this.loadedBuildId) {
          s.set({ panel: 'redstone', sidebarOpen: true });
          this.sim.playTest(e.test as never, e.circuit as never);
        }
        break;
    }
  }

  private wantedAssetVersion: string | null = null;

  /** Load textures for a client version into the viewer (once per version). */
  private async ensureTextures(version: string): Promise<boolean> {
    if (this.assetVersion === version && this.manifest) return true;
    this.wantedAssetVersion = version;
    const s = useApp.getState();
    s.set({ assetMessage: fmt(t.texturesLoading, { v: version }) });
    try {
      const manifest = await api.manifest(version);
      const atlas = await loadTextureArray(api.atlasUrl(version), manifest);
      this.viewer?.setTextures(atlas);
      this.manifest = manifest;
      this.assetVersion = version;
      s.set({ assetMessage: null, textured: true });
      return true;
    } catch (error) {
      this.viewer?.setTextures(null);
      this.manifest = null;
      this.assetVersion = null;
      s.set({ assetMessage: null, textured: false });
      s.toast(
        fmt(t.texturesFailed, { m: error instanceof Error ? error.message : String(error) }),
        'error',
      );
      return false;
    }
  }

  private async modelsFor(header: BuildHeader, textured: boolean): Promise<(BakedBlock | null)[]> {
    if (!textured) return header.palette.map((s, i) => (i === 0 ? null : fallbackModel(s)));
    const models = await this.cachedModels(header.assetVersion, header.palette.slice(1));
    return [null, ...models];
  }

  private async cachedModels(version: string, states: string[]): Promise<(BakedBlock | null)[]> {
    let cache = this.models.get(version);
    if (!cache) {
      cache = new Map();
      this.models.set(version, cache);
    }
    const missing = [...new Set(states.filter((s) => !cache.has(s)))];
    for (let k = 0; k < missing.length; k += 400) {
      const baked = await api.models(version, missing.slice(k, k + 400));
      for (const [state, m] of Object.entries(baked)) cache.set(state, m);
    }
    return states.map((s) => {
      if (/^minecraft:(air|cave_air|void_air)$/.test(s)) return null;
      const m = cache.get(s);
      return m && m.v.some((v) => v.q.length > 0) ? m : m?.fluid ? m : null;
    });
  }

  /** Models for states of the loaded build's version (the redstone simulation adds some). */
  bakedFor(states: string[]): Promise<(BakedBlock | null)[]> {
    const h = useApp.getState().header;
    if (!h) return Promise.resolve(states.map(() => null));
    if (!useApp.getState().textured || this.assetVersion !== h.assetVersion)
      return Promise.resolve(
        states.map((s) =>
          /^minecraft:(air|cave_air|void_air)$/.test(s) ? null : fallbackModel(s),
        ),
      );
    return this.cachedModels(h.assetVersion, states);
  }

  loadBuild(header: BuildHeader, keepCamera: boolean): Promise<void> {
    if (this.loadingBuildId === header.buildId && this.loadPromise) return this.loadPromise;
    this.loadingBuildId = header.buildId;
    const run = async () => {
      const s = useApp.getState();
      const sameProject = header.projectId === this.projectId;
      s.set({
        header,
        ...(sameProject
          ? {}
          : { selection: null, slice: false, sliceY: header.size[1] - 1 + header.origin[1] }),
      });
      this.projectId = header.projectId;
      const viewer = this.viewer;
      if (!viewer) return;
      const textured = await this.ensureTextures(header.assetVersion);
      const [data, models] = await Promise.all([
        api.volume(header.buildId),
        this.modelsFor(header, textured),
      ]);
      if (this.loadingBuildId !== header.buildId) return;
      const ids = new Map<string, number>();
      const nameIds = new Int32Array(header.palette.length);
      header.palette.forEach((st, i) => {
        const name = st.replace(/\[.*$/, '');
        if (!ids.has(name)) ids.set(name, ids.size);
        nameIds[i] = ids.get(name) as number;
      });
      // The simulation starts from the build as sent; the viewer's copy changes as it runs.
      const original = data.slice();
      const load = viewer.load(
        { size: header.size, data, models, nameIds },
        keepCamera || sameProject,
      );
      const st = useApp.getState();
      if (st.slice) void viewer.setClipY(st.sliceY - header.origin[1]);
      await load;
      this.loadedBuildId = header.buildId;
      void this.sim.load(header, original, models, nameIds);
    };
    this.loadPromise = run().finally(() => {
      if (this.loadingBuildId === header.buildId) this.loadPromise = null;
    });
    return this.loadPromise;
  }

  // ------------------------------------------------------------------ interaction

  private onHover(hit: PickInfo | null): void {
    const s = useApp.getState();
    const h = s.header;
    if (!hit || !h) {
      if (s.hover) s.set({ hover: null });
      return;
    }
    const pos: Vec3 = [
      hit.pos[0] + h.origin[0],
      hit.pos[1] + h.origin[1],
      hit.pos[2] + h.origin[2],
    ];
    s.set({ hover: { pos, state: h.palette[hit.id] ?? this.sim.stateOf(hit.id) ?? '' } });
  }

  private onClick(hit: PickInfo | null, shift: boolean): void {
    const s = useApp.getState();
    const h = s.header;
    if (!h) return;
    if (s.tool === 'use') {
      // Right-click in the game: flip a lever, press a button, change a repeater's delay.
      if (hit) this.sim.use(hit.pos);
      return;
    }
    if (!hit) {
      if (!shift) {
        s.set({ selection: null, noteDraft: null });
        this.viewer?.setSelection(null);
        this.selectionAnchor = null;
      }
      return;
    }
    const pos: Vec3 = [
      hit.pos[0] + h.origin[0],
      hit.pos[1] + h.origin[1],
      hit.pos[2] + h.origin[2],
    ];
    const from = shift && this.selectionAnchor ? this.selectionAnchor : pos;
    if (!shift || !this.selectionAnchor) this.selectionAnchor = pos;
    this.select(from, pos);
    if (s.tool === 'note') s.set({ noteDraft: { from, to: pos } });
  }

  select(from: Vec3, to: Vec3): void {
    const s = useApp.getState();
    const h = s.header;
    if (!h) return;
    const toLocal = (p: Vec3): Vec3 => [p[0] - h.origin[0], p[1] - h.origin[1], p[2] - h.origin[2]];
    this.viewer?.setSelection({ from: toLocal(from), to: toLocal(to) });
    s.set({ selection: { from, to, info: null } });
    void api
      .inspect(to)
      .then((info) => {
        const cur = useApp.getState().selection;
        if (cur && cur.to === to) useApp.getState().set({ selection: { ...cur, info } });
      })
      .catch(() => undefined);
  }

  clearSelection(): void {
    this.selectionAnchor = null;
    this.viewer?.setSelection(null);
    useApp.getState().set({ selection: null, noteDraft: null });
  }

  focus(from: Vec3, to: Vec3, message?: string): void {
    const h = useApp.getState().header;
    if (!h || !this.viewer) return;
    const toLocal = (p: Vec3): Vec3 => [p[0] - h.origin[0], p[1] - h.origin[1], p[2] - h.origin[2]];
    const region = { from: toLocal(from), to: toLocal(to) };
    this.viewer.frameRegion(region);
    this.viewer.setSelection(region);
    useApp.getState().set({ selection: { from, to, info: null }, focusMessage: message ?? null });
    if (message) setTimeout(() => useApp.getState().set({ focusMessage: null }), 9000);
  }

  setSlice(on: boolean, y?: number): void {
    const s = useApp.getState();
    const h = s.header;
    const sliceY = y ?? (on && !s.slice && h ? h.origin[1] + Math.floor(h.size[1] / 2) : s.sliceY);
    s.set({ slice: on, sliceY });
    if (!h || !this.viewer) return;
    void this.viewer.setClipY(on ? sliceY - h.origin[1] : null);
  }

  screenshot(): void {
    const h = useApp.getState().header;
    if (!this.viewer || !h) return;
    const { canvas } = this.viewer.renderView('user', 2048, null, this.viewer.cameraState());
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d') as CanvasRenderingContext2D;
    this.paintBackground(ctx, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `${h.name.replace(/[^\w-]+/g, '_')}.png`;
    a.click();
  }

  private paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#cfe0f4');
    g.addColorStop(1, '#f2f5f9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ------------------------------------------------------------------ captures for Claude

  private async capture(req: CaptureRequest): Promise<void> {
    try {
      const viewer = this.viewer;
      if (!viewer) throw new Error('Viewer not ready');
      if (this.loadedBuildId !== req.buildId) {
        const header = await api.build();
        if (!header || header.buildId !== req.buildId)
          throw new Error('Build changed during capture');
        await this.loadBuild(header, true);
      }
      await viewer.whenMeshed();
      const h = useApp.getState().header as BuildHeader;
      const toLocal = (p: Vec3): Vec3 => [
        p[0] - h.origin[0],
        p[1] - h.origin[1],
        p[2] - h.origin[2],
      ];
      const prevClip = viewer.clip;
      const wantClip = req.cutY !== undefined ? req.cutY - h.origin[1] : null;
      if (wantClip !== prevClip) {
        await viewer.setClipY(wantClip);
        await viewer.whenMeshed();
      }
      const focus = req.focus ? { from: toLocal(req.focus.from), to: toLocal(req.focus.to) } : null;
      const open = useApp
        .getState()
        .feedback.filter((f) => f.status === 'open')
        .sort((a, b) => a.createdAt - b.createdAt);
      const n = req.views.length;
      const cols = n > 1 ? 2 : 1;
      const rows = Math.ceil(n / cols);
      const size = req.size;
      const out = document.createElement('canvas');
      out.width = cols * size;
      out.height = rows * size;
      const ctx = out.getContext('2d') as CanvasRenderingContext2D;
      this.paintBackground(ctx, out.width, out.height);
      req.views.forEach((view, i) => {
        const ox = (i % cols) * size;
        const oy = Math.floor(i / cols) * size;
        const shot = viewer.renderView(view, size, focus, viewer.cameraState());
        ctx.drawImage(shot.canvas, ox, oy);
        // Compass: where north (-Z) points in this view.
        const c = [h.size[0] / 2, 0, h.size[2] / 2] as Vec3;
        const a = shot.project(c);
        const b = shot.project([c[0], c[1], c[2] - Math.max(4, h.size[2] / 3)]);
        if (a && b) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const cx = ox + size - 34;
          const cy = oy + size - 34;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.arc(0, 0, 22, 0, Math.PI * 2);
          ctx.fill();
          ctx.rotate(ang);
          ctx.fillStyle = '#e5484d';
          ctx.beginPath();
          ctx.moveTo(16, 0);
          ctx.lineTo(-6, -7);
          ctx.lineTo(-6, 7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = '#1d1d1f';
          ctx.font = '600 12px -apple-system, system-ui, sans-serif';
          ctx.fillText('N', cx + Math.cos(ang) * 28 - 4, cy + Math.sin(ang) * 28 + 4);
        }
        if (req.pins) {
          open.forEach((f, k) => {
            const p = f.region
              ? toLocal([
                  (f.region.from[0] + f.region.to[0]) / 2,
                  Math.max(f.region.from[1], f.region.to[1]),
                  (f.region.from[2] + f.region.to[2]) / 2,
                ] as Vec3)
              : f.pos
                ? toLocal(f.pos)
                : null;
            if (!p) return;
            const s = shot.project([p[0] + 0.5, p[1] + 1.1, p[2] + 0.5]);
            if (!s || s.x < 0 || s.y < 0 || s.x > size || s.y > size) return;
            ctx.fillStyle = '#ff9f0a';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(ox + s.x, oy + s.y - 14, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1d1d1f';
            ctx.font = '700 13px -apple-system, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`#${k + 1}`, ox + s.x, oy + s.y - 9.5);
            ctx.textAlign = 'start';
          });
        }
        const label = `${view} · ${VIEW_LABEL[view]}${req.cutY !== undefined ? ` · cut at y=${req.cutY}` : ''}`;
        ctx.font = '600 13px -apple-system, system-ui, sans-serif';
        const w = ctx.measureText(label).width + 16;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillRect(ox + 8, oy + 8, w, 24);
        ctx.fillStyle = '#1d1d1f';
        ctx.fillText(label, ox + 16, oy + 25);
      });
      if (wantClip !== prevClip) void viewer.setClipY(prevClip);
      await api.capture(req.requestId, {
        images: [{ view: req.views.join('+'), png: out.toDataURL('image/png') }],
      });
    } catch (error) {
      await api
        .capture(req.requestId, { error: error instanceof Error ? error.message : String(error) })
        .catch(() => undefined);
    }
  }
}

export const controller = new Controller();
