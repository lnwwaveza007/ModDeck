import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

// MD-15 S03 frame: back to PIN entry, language switch, then the identity choice.
export default function JoinPage() {
  const t = useTranslations("join");
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
        <PagePlaceholder page="join" />
      </main>
    </>
  );
}
