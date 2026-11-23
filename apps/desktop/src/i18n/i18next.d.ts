import "i18next";
import type { resources } from "./i18n.js";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    // English is the source: its keys are the only valid ones.
    resources: (typeof resources)["en"];
  }
}
