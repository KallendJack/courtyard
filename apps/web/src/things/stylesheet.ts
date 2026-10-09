import { addStylesheet } from "@/lib/stylesheet";
import css from "./things.css?inline";

// Things' stylesheet, added to the page once, when a page showing Things first loads.
addStylesheet("things", css);
