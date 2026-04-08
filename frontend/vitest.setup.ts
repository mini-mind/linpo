import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

import { TEST_WAIT_TIMEOUT_MS } from './src/testWait';

configure({ asyncUtilTimeout: TEST_WAIT_TIMEOUT_MS });
