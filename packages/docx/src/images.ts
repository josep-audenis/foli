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

/**
 * Object URLs (`blob:`) for the pictures' images that live in `pkg` (`word/media/…`): the view
 * cannot show a package part otherwise. Where there are no object URLs (no DOM), none.
 */
export function packageImages(pkg: DocxPackage): PackageImages {
  const urls = new Map<string, string>();
  return {
    url(key, resource) {
      const known = urls.get(key);
      if (known) return known;
      const part = pkg.part(`/${resource?.part ?? key}`);
      if (!part?.contentType.startsWith("image/") || typeof URL.createObjectURL !== "function")
        return undefined;
      const url = URL.createObjectURL(
        new Blob([part.data as BlobPart], { type: part.contentType }),
      );
      urls.set(key, url);
      return url;
    },
    revoke() {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
