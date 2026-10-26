import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/Button";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { Logo } from "@/components/shell/Logo";

// MD-15 H00. KMUTT SSO is MD-7, so the button opens My decks for now.
export default function LoginPage() {
  const t = useTranslations("login");
  return (
    <div className="flex min-h-screen flex-col bg-primary-50">
      <header className="flex justify-end px-6 py-4">
        <LanguageSwitch />
      </header>
      <main className="grid flex-1 place-items-center p-6">
        <div className="flex w-full max-w-110 flex-col gap-6 rounded-2xl border border-primary-200 bg-background px-9 py-10 shadow-md">
          <Logo size="lg" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold">{t("title")}</h1>
            <p className="text-muted">{t("description")}</p>
          </div>
          <Link href="/decks" className={buttonClass({ size: "lg", fullWidth: true })}>
            <ShieldIcon />
            {t("button")}
          </Link>
          <p className="text-center text-sm text-muted">
            {t("participantPrompt")}{" "}
            <Link href="/" className="text-primary-700 underline hover:text-primary-800">
              {t("participantLink")}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
    </svg>
  );
}
