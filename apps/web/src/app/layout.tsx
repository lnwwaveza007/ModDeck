import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const plexSansThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-sans-thai",
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "ModDeck", template: "%s · ModDeck" },
  description: "Interactive presentations, live polls, and AI-assisted Q&A.",
};

// One root layout for all three sides; each route group adds its own chrome.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const t = await getTranslations("common");

  return (
    <html
      lang={locale}
      className={`${plexSansThai.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider>
          <ToastProvider closeLabel={t("close")}>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
