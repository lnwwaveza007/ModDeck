import type { Locale } from "@/lib/i18n/config";
import type messages from "@/lib/i18n/messages/th.json";

// Type-checks every t("…") key against the Thai messages (the source language).
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
