import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--ac-font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ac-font-mono",
  display: "swap",
});

/** The class names that define the landing page's two font variables. */
export const LANDING_FONT_CLASSES = `${sans.variable} ${mono.variable}`;
