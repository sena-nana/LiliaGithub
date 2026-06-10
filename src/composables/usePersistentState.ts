import { customRef, type Ref } from "vue";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / privacy mode errors */
  }
}

export function usePersistentBoolean(
  key: string,
  defaultValue: boolean,
): Ref<boolean> {
  const stored = readStorage(key);
  let value = stored === null ? defaultValue : stored === "1";

  return customRef<boolean>((track, trigger) => {
    return {
      get() {
        track();
        return value;
      },
      set(nextValue) {
        value = nextValue;
        writeStorage(key, value ? "1" : "0");
        trigger();
      },
    };
  });
}

export interface PersistentNumberOptions {
  key: string;
  defaultValue: number;
  min?: number;
  max?: number;
}

export function clampNumber(value: number, min?: number, max?: number) {
  const minClamped = typeof min === "number" ? Math.max(min, value) : value;
  return typeof max === "number" ? Math.min(max, minClamped) : minClamped;
}

export function usePersistentNumber(options: PersistentNumberOptions): Ref<number> {
  const raw = readStorage(options.key);
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  let value =
    Number.isFinite(parsed)
      ? clampNumber(parsed, options.min, options.max)
      : clampNumber(options.defaultValue, options.min, options.max);

  return customRef<number>((track, trigger) => {
    return {
      get() {
        track();
        return value;
      },
      set(nextValue) {
        value = clampNumber(nextValue, options.min, options.max);
        writeStorage(options.key, String(value));
        trigger();
      },
    };
  });
}
