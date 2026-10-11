import type { WorkspaceIcon } from "@courtyard/contract";
import {
  Bike,
  Book,
  Briefcase,
  Camera,
  CodeXml,
  Dumbbell,
  Heart,
  House,
  type LucideIcon,
  Mountain,
  Music,
  Server,
  Sprout,
  Wallet,
  Warehouse,
  Wrench,
} from "lucide-react";

/**
 * Each icon a workspace can show (#210, Paper board Handheld · 36), from the app's own icon
 * library in its plain line style, and its name in the Icon sheet. Off the first load: the page
 * shows each icon's slot until this has loaded.
 */
export const ICONS: Readonly<Record<WorkspaceIcon, { draw: LucideIcon; name: string }>> = {
  bicycle: { draw: Bike, name: "Bicycle" },
  garage: { draw: Warehouse, name: "Garage" },
  house: { draw: House, name: "House" },
  dumbbell: { draw: Dumbbell, name: "Dumbbell" },
  server: { draw: Server, name: "Server" },
  code: { draw: CodeXml, name: "Code" },
  book: { draw: Book, name: "Book" },
  sprout: { draw: Sprout, name: "Plant" },
  mountain: { draw: Mountain, name: "Mountain" },
  camera: { draw: Camera, name: "Camera" },
  wallet: { draw: Wallet, name: "Wallet" },
  heart: { draw: Heart, name: "Heart" },
  briefcase: { draw: Briefcase, name: "Briefcase" },
  wrench: { draw: Wrench, name: "Wrench" },
  music: { draw: Music, name: "Music" },
};

/**
 * A workspace's icon, filling its slot (sized by name, so a button's own icon size leaves it be),
 * in the colour of what it's in.
 */
export default function WorkspaceMark(props: { icon: WorkspaceIcon }) {
  const { draw: Draw } = ICONS[props.icon];
  return (
    <Draw aria-hidden data-workspace-icon={props.icon} className="size-full" strokeWidth={1.6} />
  );
}
