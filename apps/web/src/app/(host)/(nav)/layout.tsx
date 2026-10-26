import Link from "next/link";
import { HostNav } from "@/components/shell/HostNav";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { Logo } from "@/components/shell/Logo";

// MD-15 H01/H12 header: logo, section tabs, language. The account menu comes with login (MD-7).
export default function HostNavLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-neutral-200 bg-background px-6">
        <Link
          href="/decks"
          className="flex h-16 items-center rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Logo />
        </Link>
        <HostNav />
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
