import type React from 'react';
import { useEffect } from 'react';

const RAW_TUTORIAL_PATH = '/pairing/tutorial.md';

export function PairingTutorialPage(): JSX.Element {
  useEffect(() => {
    window.location.replace(RAW_TUTORIAL_PATH);
  }, []);

  return <section aria-label="pairing-tutorial-page" />;
}
