import { useTranslations } from "next-intl";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { SessionHeader } from "@/components/shell/SessionHeader";

// MD-15 H02 frame: header, slide list on the left, canvas in the middle.
export default function DeckEditorPage() {
  const t = useTranslations();
  return (
    <>
      <SessionHeader leading="back" title={t("pages.deckEditor.title")} />
      <div className="flex flex-1 flex-wrap items-stretch">
        <nav
          aria-label={t("host.slides")}
          className="flex-[0_0_200px] border-r border-neutral-200 bg-background px-2 py-3"
        />
        <main className="flex min-w-0 flex-[999_1_560px] flex-col p-6">
          <PagePlaceholder page="deckEditor" titled={false} />
        </main>
      </div>
    </>
  );
}
