interface P {
  size?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const IconSearch = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
)

export const IconClose = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const IconFilter = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M3 6h18M7 12h10M10 18h4" />
  </svg>
)

export const IconSun = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </svg>
)

export const IconMoon = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export const IconStar = ({ size = 17, filled = false }: P & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
  </svg>
)

export const IconBag = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M6 8h12l1 12H5L6 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
)

export const IconCompare = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="7" height="14" rx="1.5" />
    <rect x="14" y="5" width="7" height="14" rx="1.5" />
  </svg>
)

export const IconChevronDown = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="m5 9 7 7 7-7" />
  </svg>
)

export const IconChevronL = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="m15 5-7 7 7 7" />
  </svg>
)

export const IconChevronR = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
)

export const IconCopy = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)

export const IconMore = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconUpload = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M12 20V9" />
    <path d="m8 13 4-4 4 4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)

export const IconLibrary = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="7" height="16" rx="1.5" />
    <rect x="13" y="4" width="8" height="7" rx="1.5" />
    <rect x="13" y="13" width="8" height="7" rx="1.5" />
  </svg>
)

export const IconSpark = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
  </svg>
)

export const IconSettings = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.4.66.73.87H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const IconPrompt = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M4 6h16M4 12h10M4 18h13" />
    <path d="M18 15.5v4M16 17.5h4" />
  </svg>
)

export const IconSave = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3v11" />
    <path d="m8 10 4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)

export const IconLink = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 6.3" />
    <path d="M14 11a4 4 0 0 0-5.7 0L6 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
  </svg>
)

export const IconTrash = ({ size = 17 }: P) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
)
