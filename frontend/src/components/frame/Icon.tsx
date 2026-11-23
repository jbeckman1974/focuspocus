const lilac = "var(--glyph-lilac, #c7a2ed)";
const apricot = "var(--glyph-apricot, #ffbd70)";
const mint = "var(--glyph-mint, #82dcb4)";
const sky = "var(--glyph-sky, #90cff3)";
const rose = "var(--glyph-rose, #fc9ab3)";
const paper = "var(--glyph-paper, #fff8fb)";

const glyphs = {
  inbox: (
    <>
      <path
        fill={apricot}
        d="M6 4.5h12l3 8v6.3a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 18.8v-6.3z"
      />
      <path fill={paper} d="M5 12h4l1.6 2.8h2.8L15 12h4" />
    </>
  ),
  projects: (
    <path
      fill={lilac}
      d="M2.5 7a2 2 0 0 1 2-2H9l2.1 2.4h8.4a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"
    />
  ),
  folder: (
    <>
      <path
        fill={apricot}
        d="M2.5 7a2 2 0 0 1 2-2h4.1L11 7.5h8.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"
      />
      <path d="M3.3 10h17.4" />
    </>
  ),
  tags: (
    <>
      <path
        fill={mint}
        d="M3.4 4.7h7.7l9 9a1.5 1.5 0 0 1 0 2.1l-5.4 5.4a1.5 1.5 0 0 1-2.1 0l-9.2-9.3z"
      />
      <circle cx="7.6" cy="8.9" r="1.25" fill={paper} />
    </>
  ),
  flag: (
    <>
      <path
        fill={rose}
        d="M5 4.5c4.3-3.1 8.7 3.2 14.5-.1v10.2C13.9 18 9.8 11.7 5 15z"
      />
      <path d="M5 3.5v17.2" />
    </>
  ),
  complete: (
    <>
      <circle cx="12" cy="12" r="9.2" fill={mint} />
      <path d="m7.8 12.2 2.7 2.9 5.8-6" />
    </>
  ),
  changed: (
    <>
      <circle cx="12" cy="12" r="9.2" fill={apricot} />
      <path d="M12 6.3v6l4 2.4" />
    </>
  ),
  all: (
    <>
      <rect x="3.5" y="3.8" width="17" height="16.4" rx="2.3" fill={sky} />
      <path d="M9.7 8h7m-7 4h7m-7 4h7M7 8h.01M7 12h.01M7 16h.01" />
    </>
  ),
  board: (
    <>
      <rect x="2.8" y="4.5" width="5.2" height="14.8" rx="1.5" fill={lilac} />
      <rect x="9.4" y="4.5" width="5.2" height="10.4" rx="1.5" fill={apricot} />
      <rect x="16" y="4.5" width="5.2" height="12.8" rx="1.5" fill={mint} />
    </>
  ),
  calendar: (
    <>
      <rect x="3.3" y="5.4" width="17.4" height="15.5" rx="2.3" fill={paper} />
      <path
        fill={rose}
        d="M3.3 8a2.6 2.6 0 0 1 2.6-2.6h12.2A2.6 2.6 0 0 1 20.7 8v2.3H3.3z"
      />
      <path d="M7.5 3v4.2m9-4.2v4.2M7.8 14.5h2.1m3.6 0h2.1" />
    </>
  ),
  review: (
    <>
      <rect x="4.5" y="4.8" width="15" height="16.5" rx="2" fill={mint} />
      <rect x="8.4" y="2.8" width="7.2" height="4.6" rx="1.3" fill={paper} />
      <path d="m8.5 13.2 2.5 2.5 4.6-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.8" fill={sky} />
      <path d="m15.5 15.5 5.1 5.1" strokeWidth="2.5" />
    </>
  ),
  star: (
    <path
      fill={apricot}
      d="m12 2.7 2.8 5.8 6.5 1-4.7 4.6 1.1 6.4-5.7-3.1-5.7 3.1 1.1-6.4-4.7-4.6 6.5-1z"
    />
  ),
  preferences: (
    <>
      <path
        fill={lilac}
        d="m10 2.8 4 .1.7 2.5 1.6 1 2.6-.6 2 3.3-1.9 2 .1 2 1.7 1.9-2.1 3.4-2.5-.7-1.6 1-.7 2.5h-3.8l-.7-2.5-1.6-1-2.6.6-2-3.3 1.8-1.9v-2.2L3.2 9l2-3.3 2.6.6 1.5-.9z"
      />
      <circle cx="12" cy="12" r="3.4" fill={paper} />
    </>
  ),
  add: (
    <path stroke="currentColor" d="M12 4.8v14.4M4.8 12h14.4" strokeWidth="2" />
  ),
  inspector: (
    <>
      <rect x="2.8" y="4.3" width="18.4" height="15.4" rx="2.4" fill={paper} />
      <path
        fill={lilac}
        d="M14.3 4.3h4.5a2.4 2.4 0 0 1 2.4 2.4v10.6a2.4 2.4 0 0 1-2.4 2.4h-4.5z"
      />
    </>
  ),
  browse: (
    <>
      <rect x="2.8" y="4.3" width="18.4" height="15.4" rx="2.4" fill={paper} />
      <path
        fill={sky}
        d="M9.7 4.3H5.2a2.4 2.4 0 0 0-2.4 2.4v10.6a2.4 2.4 0 0 0 2.4 2.4h4.5z"
      />
    </>
  ),
  close: <path stroke="currentColor" d="m6 6 12 12M18 6 6 18" />,
  reset: (
    <path
      stroke="currentColor"
      d="M4.1 11.4a8 8 0 1 1 2.5 6.9m-2.5-7V5.5m0 5.8h5.7"
    />
  ),
  mark: (
    <g stroke="none" fill="currentColor">
      <path d="M9.6 4.9c1.1 4.3 2.2 5.5 6.6 6.7-4.4 1.1-5.5 2.2-6.6 6.5C8.4 13.8 7.3 12.7 3 11.6c4.3-1.2 5.4-2.4 6.6-6.7Z" />
      <path d="M17.4 1.3c.5 2.5 1.2 3.2 3.8 3.8-2.6.6-3.3 1.3-3.8 3.8-.7-2.5-1.3-3.2-3.9-3.8 2.6-.6 3.2-1.3 3.9-3.8Zm.7 13.2c.4 1.6 1 2.1 2.5 2.6-1.5.4-2.1 1-2.5 2.5-.5-1.5-1-2.1-2.6-2.5 1.6-.5 2.1-1 2.6-2.6Z" />
    </g>
  ),
  details: (
    <>
      <rect x="4.5" y="3.6" width="15" height="16.8" rx="2.2" fill={sky} />
      <path d="M8.2 9h7.6m-7.6 4h5.2" />
    </>
  ),
} as const;

export type IconName = keyof typeof glyphs;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--glyph-outline, currentColor)"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphs[name]}
    </svg>
  );
}
