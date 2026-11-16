import type { ResourceJSON } from "@folijs/core";
import type { DocxPackage } from "./package.js";

/** URLs for the images of a package's pictures, for the view to show them. */
export interface PackageImages {
  /**
   * An object URL for the image of resource `key` when it is a part of the package (made once,
   * then reused); undefined otherwise. Fits `EditorViewOptions.resource`.
   */
  url(key: string, resource?: ResourceJSON): string | undefined;
  /** Frees every URL made (they stop working). */
  revoke(): void;
}

/** Image types browsers show in an `img`; EMF, WMF and TIFF parts are shown as a box. */
const RASTER = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);

/**
 * URLs for the pictures' images that live in `pkg` (`word/media/…`): the view cannot show a
 * package part otherwise. Raster images get object URLs (`blob:`); an SVG gets a `data:` URL,
 * never a `blob:` one (opened on its own, a `blob:` SVG would run its scripts as the app's
 * origin; a `data:` document has none). Types browsers cannot show, and where there are no
 * object URLs (no DOM), none.
 */
export function packageImages(pkg: DocxPackage): PackageImages {
  const urls = new Map<string, string>();
  const blobs: string[] = [];
  return {
    url(key, resource) {
      const known = urls.get(key);
      if (known) return known;
      const part = resource?.part ? pkg.part(`/${resource.part}`) : undefined;
      if (!part) return undefined;
      let url: string;
      if (part.contentType === "image/svg+xml") {
        let binary = "";
        for (const byte of part.data) binary += String.fromCharCode(byte);
        url = `data:image/svg+xml;base64,${btoa(binary)}`;
      } else if (RASTER.has(part.contentType) && typeof URL.createObjectURL === "function") {
        url = URL.createObjectURL(new Blob([part.data as BlobPart], { type: part.contentType }));
        blobs.push(url);
      } else return undefined;
      urls.set(key, url);
      return url;
    },
    revoke() {
      for (const url of blobs) URL.revokeObjectURL(url);
      blobs.length = 0;
      urls.clear();
    },
  };
}
