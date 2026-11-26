"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { slideImageUrl } from "@/lib/api/slides";
import { ImageControls } from "./ElementPanel";

/**
 * The picture of a poll or word cloud. The projector shows it with the question until the host
 * starts the activity; from then on the options, the chart or the cloud take its place.
 */
export function ActivityImageField({
  imageRef,
  onUpload,
  onRemove,
}: {
  imageRef: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
}) {
  const t = useTranslations("editor.activityImage");
  return (
    <div className="flex flex-col gap-1.5">
      <ImageControls hasImage={imageRef !== null} onUpload={onUpload} />
      {imageRef && (
        <>
          <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-surface">
            <Image
              src={slideImageUrl(imageRef)}
              alt={t("alt")}
              fill
              unoptimized
              sizes="20rem"
              className="object-contain"
            />
          </div>
          <Button variant="ghost" className="self-start" onClick={onRemove}>
            {t("remove")}
          </Button>
        </>
      )}
      <p className="text-sm text-muted">{t("help")}</p>
    </div>
  );
}
