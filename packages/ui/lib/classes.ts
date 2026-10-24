/**
 * Joins class names, skipping the ones switched off. For components on the first load: unlike a
 * class-merging helper such as `cn`, it doesn't merge conflicting Tailwind classes, which keeps that
 * code out of the first load, so these components take explicit options instead of overriding
 * classes.
 */
export const classes = (...names: readonly (string | false | undefined)[]) =>
  names.filter(Boolean).join(" ");
