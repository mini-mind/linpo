import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BinaryFilePreview, JsonPreview } from './collabOutputPreview';

describe('collabOutputPreview', () => {
  it('renders markdown fallback when json parsing fails', () => {
    render(<JsonPreview content={'not-json'} markdownStyle={{ color: '#334155' }} />);
    expect(screen.getByText('not-json')).toBeInTheDocument();
  });

  it('renders image preview for image mime type', () => {
    render(
      <BinaryFilePreview
        mimeType="image/png"
        fileUrl="data:image/png;base64,iVBORw0KGgo="
        emptyTextStyle={{ color: '#334155' }}
      />
    );
    const image = screen.getByRole('img', { name: '任务产出预览' });
    expect(image).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
  });

  it('renders pdf preview for pdf mime type', () => {
    render(
      <BinaryFilePreview
        mimeType="application/pdf"
        fileUrl="about:blank"
        emptyTextStyle={{ color: '#334155' }}
      />
    );
    expect(screen.getByTitle('任务产出 PDF 预览')).toHaveAttribute('src', 'about:blank');
  });

  it('renders fallback hint for unsupported mime type', () => {
    render(
      <BinaryFilePreview
        mimeType="application/octet-stream"
        fileUrl="about:blank"
        emptyTextStyle={{ color: '#334155' }}
      />
    );
    expect(screen.getByText('该文件类型暂不支持内嵌预览，请下载查看。')).toBeInTheDocument();
  });
});
