import type { CSSProperties } from 'react';
import { MarkdownMessage } from './MarkdownMessage';
import {
  formatJsonPrimitive,
  isAudioMimeType,
  isImageMimeType,
  isPdfMimeType,
  isVideoMimeType,
  tryParseJsonValue,
} from './collabTaskPreviewUtils';

export function JsonPreview({
  content,
  markdownStyle,
}: {
  content: string;
  markdownStyle: CSSProperties;
}): JSX.Element {
  const parsed = tryParseJsonValue(content);
  if (parsed === null) {
    return <MarkdownMessage text={content} style={markdownStyle} />;
  }
  return (
    <div style={jsonPreviewContainerStyle}>
      <JsonTreeNode value={parsed} depth={0} label="root" />
    </div>
  );
}

function JsonTreeNode({
  value,
  depth,
  label,
}: {
  value: unknown;
  depth: number;
  label?: string;
}): JSX.Element {
  const labelPrefix = label ? <span style={jsonKeyStyle}>{label}: </span> : null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return (
      <div style={jsonLeafRowStyle}>
        {labelPrefix}
        <span style={jsonPrimitiveStyle}>{formatJsonPrimitive(value)}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div style={jsonLeafRowStyle}>
          {labelPrefix}
          <span style={jsonPrimitiveStyle}>[]</span>
        </div>
      );
    }
    return (
      <details style={jsonDetailsStyle} open={depth < 1}>
        <summary style={jsonSummaryStyle}>
          {labelPrefix}
          <span style={jsonSummaryTextStyle}>Array({value.length})</span>
        </summary>
        <div style={jsonChildrenStyle}>
          {value.map((item, index) => (
            <JsonTreeNode key={`arr-${depth}-${index}`} value={item} depth={depth + 1} label={`${index}`} />
          ))}
        </div>
      </details>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div style={jsonLeafRowStyle}>
          {labelPrefix}
          <span style={jsonPrimitiveStyle}>{'{}'}</span>
        </div>
      );
    }
    return (
      <details style={jsonDetailsStyle} open={depth < 1}>
        <summary style={jsonSummaryStyle}>
          {labelPrefix}
          <span style={jsonSummaryTextStyle}>Object({entries.length})</span>
        </summary>
        <div style={jsonChildrenStyle}>
          {entries.map(([key, item]) => (
            <JsonTreeNode key={`obj-${depth}-${key}`} value={item} depth={depth + 1} label={key} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div style={jsonLeafRowStyle}>
      {labelPrefix}
      <span style={jsonPrimitiveStyle}>{String(value)}</span>
    </div>
  );
}

export function BinaryFilePreview({
  mimeType,
  fileUrl,
  emptyTextStyle,
}: {
  mimeType: string;
  fileUrl: string | null;
  emptyTextStyle: CSSProperties;
}): JSX.Element {
  if (!fileUrl) {
    return <p style={emptyTextStyle}>该文件类型暂不支持内嵌预览，请下载查看。</p>;
  }
  if (isImageMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <img src={fileUrl} alt="任务产出预览" style={binaryImageStyle} />
      </div>
    );
  }
  if (isPdfMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <iframe title="任务产出 PDF 预览" src={fileUrl} style={binaryIframeStyle} />
      </div>
    );
  }
  if (isVideoMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <video controls style={binaryVideoStyle} src={fileUrl} />
      </div>
    );
  }
  if (isAudioMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <audio controls style={binaryAudioStyle} src={fileUrl} />
      </div>
    );
  }
  return <p style={emptyTextStyle}>该文件类型暂不支持内嵌预览，请下载查看。</p>;
}

const jsonPreviewContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  paddingRight: '0.1rem',
};

const jsonDetailsStyle: CSSProperties = {
  borderLeft: '1px solid rgba(148, 163, 184, 0.24)',
  marginLeft: '0.3rem',
  paddingLeft: '0.35rem',
};

const jsonSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  fontSize: '0.75rem',
  color: '#1f2937',
  userSelect: 'none',
};

const jsonSummaryTextStyle: CSSProperties = {
  color: '#475569',
};

const jsonChildrenStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
  marginTop: '0.2rem',
};

const jsonLeafRowStyle: CSSProperties = {
  fontSize: '0.75rem',
  lineHeight: 1.4,
  color: '#334155',
};

const jsonKeyStyle: CSSProperties = {
  color: '#0f766e',
  fontWeight: 700,
};

const jsonPrimitiveStyle: CSSProperties = {
  color: '#1e293b',
  fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

const binaryPreviewWrapStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '0.4rem',
  border: '1px dashed rgba(148, 163, 184, 0.35)',
  background: 'rgba(248, 250, 252, 0.72)',
  padding: '0.45rem',
};

const binaryImageStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  borderRadius: '0.25rem',
};

const binaryIframeStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '260px',
  border: 'none',
  borderRadius: '0.3rem',
  background: '#fff',
};

const binaryVideoStyle: CSSProperties = {
  width: '100%',
  maxHeight: '100%',
  borderRadius: '0.25rem',
  background: '#000',
};

const binaryAudioStyle: CSSProperties = {
  width: '100%',
};
