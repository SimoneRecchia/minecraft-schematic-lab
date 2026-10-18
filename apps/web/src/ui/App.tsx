import { useEffect } from 'react';
import { controller } from '../controller';
import { useSim } from '../sim/simStore';
import { useApp } from '../store';
import { Empty, FocusMessage, Gizmo, Inspector, LayerSlider, Status, Toasts } from './Overlays';
import { SimBar } from './Redstone';
import { Scene } from './Scene';
import { ExportSheet, ProjectsPopover, VersionPopover } from './Sheets';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Keyboard shortcuts, Blender-flavoured (numpad views, 5 ortho, Home/F frame). */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey) return;
      const s = useApp.getState();
      const v = controller.viewer;
      const key = e.key.toLowerCase();
      const opposite = e.ctrlKey;
      switch (key) {
        case 'escape':
          s.set({ exportOpen: false, versionOpen: false, projectsOpen: false, noteDraft: null });
          controller.clearSelection();
          return;
        case 'v':
          s.set({ tool: 'navigate', noteDraft: null });
          return;
        case 'u':
          s.set({ tool: 'use', noteDraft: null });
          return;
        case ' ':
          if (useSim.getState().available) {
            e.preventDefault();
            controller.sim.toggle();
          }
          return;
        case 't':
          if (useSim.getState().available) controller.sim.step(1);
          return;
        case 'n':
          s.set({ tool: 'note' });
          return;
        case 's':
          s.set({ sidebarOpen: !s.sidebarOpen });
          return;
        case 'l':
          controller.setSlice(!s.slice);
          return;
        case 'g':
          v?.setGridVisible(!s.grid);
          s.set({ grid: !s.grid });
          return;
        case '5':
          v?.setOrtho(!s.ortho);
          s.set({ ortho: !s.ortho });
          return;
        case '0':
          v?.frameView('iso', null);
          return;
        case '1':
          v?.frameView(opposite ? 'back' : 'front', null);
          return;
        case '3':
          v?.frameView(opposite ? 'left' : 'right', null);
          return;
        case '7':
          v?.frameView('top', null);
          return;
        case '4':
          v?.orbit(-Math.PI / 12, 0);
          return;
        case '6':
          v?.orbit(Math.PI / 12, 0);
          return;
        case '8':
          v?.orbit(0, -Math.PI / 12);
          return;
        case '2':
          v?.orbit(0, Math.PI / 12);
          return;
        case 'home':
        case 'h':
          v?.frameRegion(null);
          return;
        case 'f':
        case '.': {
          const sel = s.selection;
          const h = s.header;
          if (sel && h) {
            const toLocal = (p: number[]) =>
              p.map((n, i) => n - (h.origin[i] as number)) as [number, number, number];
            v?.frameRegion({ from: toLocal(sel.from), to: toLocal(sel.to) });
          } else v?.frameRegion(null);
          return;
        }
        case 'arrowup':
        case 'arrowdown':
          if (s.slice && s.header) {
            e.preventDefault();
            const min = s.header.origin[1];
            const max = min + s.header.size[1] - 1;
            controller.setSlice(
              true,
              Math.max(min, Math.min(max, s.sliceY + (key === 'arrowup' ? 1 : -1))),
            );
          }
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useShortcuts();
  useEffect(() => {
    controller.start();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => {
      useApp.getState().set({ dark: mq.matches });
      controller.viewer?.setTheme(mq.matches);
    };
    mq.addEventListener('change', onTheme);
    return () => mq.removeEventListener('change', onTheme);
  }, []);
  return (
    <>
      <Scene />
      <Empty />
      <Sidebar />
      <Toolbar />
      <Gizmo />
      <Inspector />
      <LayerSlider />
      <FocusMessage />
      <SimBar />
      <Status />
      <Toasts />
      <VersionPopover />
      <ProjectsPopover />
      <ExportSheet />
    </>
  );
}
