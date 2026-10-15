import { create } from 'zustand';
import type {
  BuildHeader,
  FeedbackItem,
  InspectResult,
  ProjectInfo,
  Vec3,
  VersionOption,
  VersionSummary,
} from '@minecraft-schematic-lab/shared';

export type Panel = 'build' | 'materials' | 'history' | 'notes';
export type Tool = 'navigate' | 'note';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'success' | 'error';
}

export interface Hover {
  pos: Vec3;
  state: string;
}

export interface Selection {
  from: Vec3;
  to: Vec3;
  info: InspectResult | null;
}

interface AppState {
  connected: boolean;
  clientId: string | null;
  header: BuildHeader | null;
  compiling: string | null;
  buildErrors: string[] | null;
  assetMessage: string | null;
  meshProgress: [number, number] | null;
  textured: boolean;
  feedback: FeedbackItem[];
  projects: ProjectInfo[];
  history: VersionSummary[];
  versions: VersionOption[];
  hover: Hover | null;
  selection: Selection | null;
  tool: Tool;
  panel: Panel;
  sidebarOpen: boolean;
  slice: boolean;
  /** Spec-coordinate y of the layer cut. */
  sliceY: number;
  grid: boolean;
  ortho: boolean;
  exportOpen: boolean;
  versionOpen: boolean;
  projectsOpen: boolean;
  noteDraft: { from: Vec3; to: Vec3 } | null;
  focusMessage: string | null;
  toasts: Toast[];
  dark: boolean;
  set: (patch: Partial<AppState>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  connected: false,
  clientId: null,
  header: null,
  compiling: null,
  buildErrors: null,
  assetMessage: null,
  meshProgress: null,
  textured: false,
  feedback: [],
  projects: [],
  history: [],
  versions: [],
  hover: null,
  selection: null,
  tool: 'navigate',
  panel: 'build',
  sidebarOpen: true,
  slice: false,
  sliceY: 0,
  grid: true,
  ortho: false,
  exportOpen: false,
  versionOpen: false,
  projectsOpen: false,
  noteDraft: null,
  focusMessage: null,
  toasts: [],
  dark: typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  set: (patch) => set(patch),
  toast: (text, tone = 'info') => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(
      () => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
      tone === 'error' ? 7000 : 3200,
    );
  },
}));
