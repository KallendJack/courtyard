/**
 * Courtyard's mark: a courtyard seen from above, with walls, an entrance and a tree, on a
 * heather tile. The same drawing as `public/icons/icon.svg`, in the theme's mark colours, which
 * stay the same in dark mode so the mark is always recognisable.
 */
export function CourtyardMark(props: { size?: number }) {
  const size = props.size ?? 28;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <rect width="64" height="64" rx="15" fill="var(--mark-tile)" />
      <path
        d="M26 47h-6a3.5 3.5 0 0 1-3.5-3.5v-23A3.5 3.5 0 0 1 20 17h24a3.5 3.5 0 0 1 3.5 3.5v23A3.5 3.5 0 0 1 44 47h-6"
        stroke="var(--mark-walls)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="31.5" r="4.5" fill="var(--mark-tree)" />
    </svg>
  );
}

/** The mark beside the name. */
export function CourtyardLockup() {
  return (
    <span className="flex items-center gap-2.5">
      <CourtyardMark />
      <span className="display-section text-xl tracking-[-0.02em]">Courtyard</span>
    </span>
  );
}
