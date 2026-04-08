import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

import { TEST_WAIT_TIMEOUT_MS } from './src/testWait';

configure({ asyncUtilTimeout: TEST_WAIT_TIMEOUT_MS });

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(String(key)) ?? null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(String(key));
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
  } as Storage;
}

function ensureCompleteLocalStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const current = window.localStorage as Partial<Storage> | undefined;
  const isValidStorage = Boolean(
    current
      && typeof current.clear === 'function'
      && typeof current.getItem === 'function'
      && typeof current.key === 'function'
      && typeof current.removeItem === 'function'
      && typeof current.setItem === 'function'
  );
  if (isValidStorage) {
    return;
  }

  const storage = createStorageMock();
  try {
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
  } catch {
    (window as { localStorage: Storage }).localStorage = storage;
  }
}

ensureCompleteLocalStorage();
