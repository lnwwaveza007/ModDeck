import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import type { Locale } from "@/lib/i18n/config";
import en from "@/lib/i18n/messages/en.json";
import th from "@/lib/i18n/messages/th.json";

export const messages = { th, en };

/** Renders with the real message files, like the root layout does. */
export function renderWithIntl(ui: ReactElement, locale: Locale = "th") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Bangkok">
      {ui}
    </NextIntlClientProvider>,
  );
}
