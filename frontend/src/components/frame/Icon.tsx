const paths = {
  inbox: "M4 5h16l1 10v4H3v-4L4 5Zm-1 9h5l2 3h4l2-3h5",
  projects: "M3 7V5h6l2 2h10v13H3V7Z",
  tags: "m3 4 8 .1L21 14l-7 7L3 10V4Zm4 3h.02",
  flag: "M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0",
  complete: "m4 12 5 5L20 6",
  changed: "M12 4a8 8 0 1 1-7 4M3 4v5h5m4-2v5l3 2",
  all: "M8 6h13M8 12h13M8 18h13M3 6h.02M3 12h.02M3 18h.02",
  preferences: "M3 7h6m4 0h8M3 17h10m4 0h4M9 4v6m8 4v6",
  add: "M12 5v14M5 12h14",
  inspector: "M3 4.5h18v15H3zM14 5v14",
  browse: "M3 4.5h18v15H3zM9 5v14",
  close: "m6 6 12 12M18 6 6 18",
  reset: "M4 11a8 8 0 1 1 2 7m-2-7V5m0 6h6",
  mark: "m4 7 8-4 8 4-8 4-8-4Zm0 5 8 4 8-4m-16 5 8 4 8-4",
  details: "M5 5h14v14H5zM9 9h6m-6 4h4",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
