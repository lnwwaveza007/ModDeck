"use client";

import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/Dialog";
import { SHORTCUT_LIST } from "@/lib/live/shortcuts";

/** The shortcut list, opened with "?" on presenter control and on the audience screen. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = useTranslations("presenter.shortcuts");
  const tc = useTranslations("common");
  return (
    <Dialog title={t("title")} closeLabel={tc("close")} onClose={onClose}>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
        {SHORTCUT_LIST.map(({ command, keys }) => (
          <div key={command} className="contents">
            <dt>{t(command)}</dt>
            <dd className="flex gap-1 justify-self-end">
              {keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded border border-neutral-300 bg-neutral-50 px-1.5 font-mono text-xs leading-5"
                >
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
