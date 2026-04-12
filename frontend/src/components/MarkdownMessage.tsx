import type React from "react";

import ReactMarkdown from "react-markdown";

interface MarkdownMessageProps {
	text: string;
	style?: React.CSSProperties;
}

export function MarkdownMessage(props: MarkdownMessageProps): JSX.Element {
	const resolvedParagraphStyle: React.CSSProperties = {
		...paragraphStyle,
		...props.style,
	};

	return (
		<div style={props.style}>
			<ReactMarkdown
				skipHtml={true}
				components={{
					p: ({ children }) => (
						<p style={resolvedParagraphStyle}>{children}</p>
					),
					pre: ({ children }) => (
						<pre style={preStyle}>{children}</pre>
					),
					code: ({ children }) => (
						<code style={codeStyle}>{children}</code>
					),
					a: ({ children, href }) => (
						<a
							href={href}
							target="_blank"
							rel="noreferrer noopener"
							style={linkStyle}
						>
							{children}
						</a>
					),
				}}
			>
				{props.text}
			</ReactMarkdown>
		</div>
	);
}

const paragraphStyle: React.CSSProperties = {
	margin: 0,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
	lineHeight: 1.5,
};

const preStyle: React.CSSProperties = {
	margin: "0.25rem 0",
	padding: "0.625rem 0.75rem",
	borderRadius: "0.5rem",
	background: "rgba(15, 23, 42, 0.06)",
	overflowX: "auto",
};

const codeStyle: React.CSSProperties = {
	fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, "Noto Sans Mono CJK SC", "PingFang SC", "Microsoft YaHei", monospace',
	fontSize: "0.85em",
};

const linkStyle: React.CSSProperties = {
	color: "#2563eb",
	textDecoration: "underline",
};
