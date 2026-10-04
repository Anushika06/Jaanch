/** Small inline stroke icons (24px grid, currentColor). Decorative: always aria-hidden. */
import type { ReactNode } from 'react';

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconImage = () => (
  <Svg>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m20.5 15.5-4.6-4.6a1.2 1.2 0 0 0-1.7 0L5 20" />
  </Svg>
);

export const IconMic = () => (
  <Svg>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);

export const IconStop = () => (
  <Svg>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconAudioFile = () => (
  <Svg>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M14 3.5v5h5M10 17v-5l4-1v5" />
    <circle cx="9" cy="17" r="1" />
    <circle cx="13" cy="16" r="1" />
  </Svg>
);

export const IconLink = () => (
  <Svg>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const IconArrowRight = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconArrowLeft = () => (
  <Svg size={18}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const IconCheck = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const IconChevron = () => (
  <Svg size={18}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconExternal = () => (
  <Svg size={16}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

export const IconPhone = () => (
  <Svg size={18}>
    <path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />
  </Svg>
);

export const IconCopy = () => (
  <Svg size={18}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2" />
    <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
  </Svg>
);

export const IconShare = () => (
  <Svg size={18}>
    <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
    <path d="M5 12.5v5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-5" />
  </Svg>
);

export const IconTrash = () => (
  <Svg size={16}>
    <path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7M9 7V4.5h6V7" />
  </Svg>
);

export const IconAlert = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.3v.2" />
  </Svg>
);

export const IconShield = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z" />
    <path d="m8.8 12 2.3 2.3 4.2-4.6" />
  </Svg>
);

export const IconLock = () => (
  <Svg size={16}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);

export const IconClock = () => (
  <Svg size={16}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconDoc = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" />
  </Svg>
);

export const IconScale = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 4v16M7 20h10M5 7h14M12 4.5 9.5 7M12 4.5 14.5 7" />
    <path d="m5 7-3 6.5a3 3 0 0 0 6 0zM19 7l-3 6.5a3 3 0 0 0 6 0z" />
  </Svg>
);

export const IconSearch = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);

export const IconSpark = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Svg>
);

export const IconClose = () => (
  <Svg size={14}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
