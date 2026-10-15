import { addStylesheet } from "@/lib/stylesheet";
import css from "./rich-blocks.css?inline";

// The rich blocks' stylesheet, added to the page once, when the answer renderer first loads.
addStylesheet("rich-blocks", css);
