import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { Logo } from "@/components/shell/Logo";
import { PinForm } from "@/components/shell/PinForm";

// Landing `/` from MD-15 Main: PIN entry for students, a link to login for hosts.
export default function Home() {
  const t = useTranslations("landing");
  return (
    <>
      <header className="flex items-center justify-between py-3 pr-2 pl-5">
        <Logo />
        <LanguageSwitch />
      </header>

      <main className="flex flex-1 flex-col gap-7 px-5 pt-12 pb-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted">{t("subtitle")}</p>
        </div>

        <PinForm />

        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-surface p-4">
          <QrIcon />
          <p className="text-sm text-neutral-700">{t("qrHint")}</p>
        </div>
      </main>

      <p className="px-5 pb-6 text-center text-sm text-muted">
        {t("hostPrompt")}{" "}
        <Link href="/login" className="text-primary-700 underline hover:text-primary-800">
          {t("hostLogin")}
        </Link>
      </p>
    </>
  );
}

function QrIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-neutral-700"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </svg>
  );
}
