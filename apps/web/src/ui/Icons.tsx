import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconCursor = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 3.5 18.5 10l-6 1.7L10 18z" />
  </svg>
);

export const IconPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);

export const IconLayers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16 8.5 4.5 8.5-4.5" />
  </svg>
);

export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" />
  </svg>
);

export const IconCube = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4z" />
    <path d="m4 7.4 8 4.6 8-4.6M12 12v9.2" />
  </svg>
);

export const IconOrtho = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 12h16M12 4v16" strokeDasharray="2 2.4" />
  </svg>
);

export const IconCamera = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.6" r="3.4" />
  </svg>
);

export const IconFrame = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
  </svg>
);

export const IconExport = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" />
    <path d="M5 13.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5" />
  </svg>
);

export const IconSidebar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconWarn = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.2 12.4a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3z" />
    <path d="M12 9.5v4M12 16.8v.2" />
  </svg>
);

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </svg>
);

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m8 10 4 4 4-4" />
  </svg>
);

export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
    <path d="M18.5 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3z" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
  </svg>
);

export const IconFullscreen = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconStep = (p: P) => (
  <svg {...base(p)}>
    <path
      d="M6 6.2v11.6a.7.7 0 0 0 1.1.6l8.6-5.8a.7.7 0 0 0 0-1.2L7.1 5.6a.7.7 0 0 0-1.1.6z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M18.5 5.5v13" strokeWidth={2.2} />
  </svg>
);

export const IconReset = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </svg>
);

/** Hand: use a block, like a right-click in the game. */
export const IconHand = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.5 11.5V5.2a1.6 1.6 0 0 1 3.2 0v5.6M11.7 10.5V4a1.6 1.6 0 0 1 3.2 0v6.8M14.9 10.8V5.6a1.6 1.6 0 0 1 3.2 0v8.2c0 4-2.6 6.7-6.3 6.7-2.6 0-4.1-1.1-5.5-3.2L4 13.6a1.6 1.6 0 0 1 2.6-1.8l1.9 2.3" />
  </svg>
);

/** Redstone: a spark. */
export const IconBolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M13.2 3 5.5 13.4h5.6L10.3 21l8.2-10.6h-5.6z" />
  </svg>
);
