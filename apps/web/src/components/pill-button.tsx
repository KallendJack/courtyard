import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Courtyard's buttons are pills: the main action filled, the others outlined or quiet. */
export function PillButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button className={cn("h-9 rounded-full px-5 font-semibold", className)} {...props} />;
}
