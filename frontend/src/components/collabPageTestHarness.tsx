import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import './collabPageTestMockRegistry';
import { ToastProvider } from '../hooks/useToast';
import { waitForLatestMockCallFirstArg } from '../testWait';
import CollabPage from './CollabPage';

export function renderCollabPage(initial = '/kanban') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ToastProvider>
        <Routes>
          <Route path="/kanban" element={<CollabPage />} />
          <Route path="/flow/edit/:flowId" element={<div>flow-page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

export async function renderCollabBoard(initial = '/kanban') {
  renderCollabPage(initial);
  return await screen.findByTestId('kanban-board');
}

export { waitForLatestMockCallFirstArg };
