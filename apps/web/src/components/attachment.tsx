import { sizeInWords } from "@courtyard/contract";
import { FileText, X } from "lucide-react";
import { classes } from "@/lib/classes";
import { IconButton } from "./button.tsx";

/**
 * Where an attachment shows (#78): in the message box's tray before sending, with a button to take
 * it off, or in the sent message.
 */
type Where = { readonly in: "tray"; readonly onRemove: () => void } | { readonly in: "message" };

/** The tray's Remove badge, on the thumbnail's or chip's corner. */
function RemoveBadge(props: { name: string; onRemove: () => void }) {
  return (
    <span className="absolute -top-1.5 -right-1.5">
      <IconButton
        label={`Remove ${props.name}`}
        icon={<X />}
        size="badge"
        look="badge"
        onClick={props.onRemove}
      />
    </span>
  );
}

/**
 * A photo's thumbnail: small in the tray, with Remove; larger in the sent message, where a tap
 * opens it full size.
 */
export function PhotoThumb(props: { src: string; name: string; onOpen?: () => void } & Where) {
  const image = (
    <img
      src={props.src}
      alt={props.name}
      className="size-full rounded-md object-cover"
      draggable={false}
    />
  );
  if (props.in === "tray") {
    return (
      <span className="relative block size-14 shrink-0 max-md:size-13">
        {image}
        <RemoveBadge name={props.name} onRemove={props.onRemove} />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`View ${props.name}`}
      onClick={props.onOpen}
      className="block size-[143px] shrink-0 overflow-hidden rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {image}
    </button>
  );
}

/**
 * A PDF as a chip with its name and size: in the tray, with Remove; in the sent message, a link
 * that opens it in a new tab.
 */
export function PdfChip(props: { name: string; size: number; href?: string } & Where) {
  const size = sizeInWords(props.size);
  if (props.in === "tray") {
    return (
      <span className="relative flex h-14 min-w-0 items-center gap-2.5 rounded-md bg-background pr-3.5 pl-3 max-md:h-13 max-md:gap-2 max-md:pr-3 max-md:pl-2.5">
        <FileText aria-hidden className="size-5 shrink-0 text-primary-text max-md:size-[18px]" />
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-sm/[18px] font-medium">{props.name}</span>
          <span className="text-xs text-muted-foreground">
            <span className="max-md:hidden">PDF · </span>
            {size}
          </span>
        </span>
        <RemoveBadge name={props.name} onRemove={props.onRemove} />
      </span>
    );
  }
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener"
      className={classes(
        "flex max-w-full min-w-0 items-center gap-2 self-start rounded-md bg-field py-1.5 pr-3 pl-2 text-foreground",
        "outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      <FileText aria-hidden className="size-4 shrink-0 text-primary-text" />
      <span className="truncate text-sm/[18px] font-medium">{props.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{size}</span>
    </a>
  );
}
