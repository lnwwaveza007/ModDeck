import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { JoinFlow } from "@/components/join/JoinFlow";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";

// QR target and PIN entry result (MD-5 §6, MD-15 S03). KMUTT SSO returns here with
// ?sso=1 to finish the join, or with ?sso_error=<code> when the login failed.
export default async function JoinPage({ params, searchParams }: PageProps<"/j/[pin]">) {
  const { pin } = await params;
  const query = await searchParams;
  const ssoError = typeof query.sso_error === "string" ? query.sso_error : undefined;
  const t = await getTranslations("join");
  return (
    <>
      <header className="flex items-center justify-between px-2 py-3">
        <Link
          href="/"
          aria-label={t("back")}
          className="grid size-11 place-items-center rounded-md text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 flex-col">
        <JoinFlow pin={pin} sso={query.sso === "1"} ssoError={ssoError} />
      </main>
    </>
  );
}
