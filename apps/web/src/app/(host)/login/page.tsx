import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { API_BASE_URL } from "@/lib/api/client";
import { buttonClass } from "@/components/ui/Button";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { Logo } from "@/components/shell/Logo";

const ERROR_CODES = ["invalid_state", "invalid_token", "login_failed"] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

// The API redirects here with ?error=<code>. Unknown codes fall back to login_failed.
function toErrorCode(value: string | string[] | undefined): ErrorCode | null {
  if (value === undefined) return null;
  const code = Array.isArray(value) ? value[0] : value;
  return (ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : "login_failed";
}

// MD-15 H00. Host login through KMUTT SSO (MD-7).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const t = await getTranslations("login");
  const errorCode = toErrorCode((await searchParams).error);
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
          {errorCode && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {t(`errors.${errorCode}`)}
            </p>
          )}
          {/* Plain anchor on purpose: full-page redirect to the API, not a Next route. */}
          <a
            href={`${API_BASE_URL}/auth/login`}
            className={buttonClass({ size: "lg", fullWidth: true })}
          >
            <ShieldIcon />
            {t("button")}
          </a>
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
