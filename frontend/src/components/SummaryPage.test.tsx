import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { SummaryPage } from './SummaryPage';

describe('SummaryPage', () => {
  it('redirects legacy /summary entry to /kanban', async () => {
    render(
      <MemoryRouter initialEntries={['/summary']}>
        <Routes>
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/kanban" element={<div>kanban-page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('kanban-page')).toBeInTheDocument();
  });
});
