import { addStylesheet } from "@/lib/stylesheet";
import css from "./home.css?inline";

// Home's stylesheet, added to the page once, when its tiles' lines or its foot rows first load.
addStylesheet("home", css);
