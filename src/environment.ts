import type { StorageBackend } from "./types";

export class CachianEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CachianEnvironmentError";
  }
}

function canUseLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function canUseIndexedDB(): boolean {
  try {
    return typeof globalThis.indexedDB !== "undefined";
  } catch {
    return false;
  }
}

/** Throw if the selected backend API is unavailable in this runtime. */
export function assertStorageAvailable(storage: StorageBackend = "localStorage"): void {
  if (storage === "indexedDB") {
    if (!canUseIndexedDB()) {
      throw new CachianEnvironmentError(
        "cachian requires a browser environment with IndexedDB",
      );
    }
    return;
  }

  if (!canUseLocalStorage()) {
    throw new CachianEnvironmentError(
      "cachian requires a browser environment with localStorage",
    );
  }
}
