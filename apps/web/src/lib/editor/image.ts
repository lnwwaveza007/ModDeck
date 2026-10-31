/**
 * Width divided by height of an image file, read in the browser before it is uploaded, so the new
 * image element on the slide has the picture's own shape. Falls back to 16:9 when the browser
 * cannot say.
 */
export async function readImageAspect(file: File): Promise<number> {
  const fallback = 16 / 9;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return fallback;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve) => {
      const image = new Image();
      image.onload = () =>
        resolve(
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : fallback,
        );
      image.onerror = () => resolve(fallback);
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
