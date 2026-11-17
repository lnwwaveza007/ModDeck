import type { SlideDto } from "@moddeck/shared";

/**
 * Brings the slides of a PDF import into the editor without touching what the host is doing. A
 * slide the import has not finished takes the server's version once it is finished. Slides that
 * are new on the server (the pages, right after the upload) go at the end. Every other slide
 * keeps what the editor has, so an edit that is still waiting to be saved is not lost.
 */
export function mergeImported(local: SlideDto[], server: SlideDto[]): SlideDto[] {
  const fresh = new Map(server.map((slide) => [slide.id, slide]));
  const known = new Set(local.map((slide) => slide.id));
  const merged = local.map((slide) => {
    const update = fresh.get(slide.id);
    // Only a slide the import is still working on, or gave up on, can change under the host.
    if (!update || !slide.importStatus || update.importStatus === slide.importStatus) return slide;
    return update;
  });
  const added = server.filter((slide) => !known.has(slide.id));
  return [...merged, ...added].map((slide, position) => ({ ...slide, position }));
}
