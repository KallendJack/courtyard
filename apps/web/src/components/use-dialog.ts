import { type MouseEvent, useEffect, useRef } from "react";

/**
 * The browser's own dialog, open while `open` is, for a sheet (sheet.tsx, handheld-sheet.tsx):
 * shown modal, so focus, Escape and screen readers work as they should, and closed by a tap on the
 * page around it as well as by Escape. Spread what it returns onto the `<dialog>`. Safe on the
 * first load (ADR 0012).
 */
export const useDialog = (open: boolean, onClose: () => void) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return {
    ref,
    onClose,
    // A tap on the dialog itself, not on anything in it, is a tap on the page around it.
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
  };
};
