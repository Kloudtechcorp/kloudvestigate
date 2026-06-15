"use client";

import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";

type MermaidDiagramProps = {
  chart: string;
  title: string;
};

const mermaidColorFallbacks = {
  "--mermaid-primary": "#fff7cc",
  "--foreground": "#242424",
  "--mermaid-primary-border": "#d1ae05",
  "--mermaid-line": "#686868",
  "--mermaid-secondary": "#f4f1df",
  "--surface": "#ffffff"
} as const;

function getMermaidColor(colorName: keyof typeof mermaidColorFallbacks) {
  return getComputedStyle(document.documentElement).getPropertyValue(colorName).trim() || mermaidColorFallbacks[colorName];
}

export function MermaidDiagram({ chart, title }: MermaidDiagramProps) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const diagramId = `architecture-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    async function renderDiagram() {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: getMermaidColor("--mermaid-primary"),
            primaryTextColor: getMermaidColor("--foreground"),
            primaryBorderColor: getMermaidColor("--mermaid-primary-border"),
            lineColor: getMermaidColor("--mermaid-line"),
            secondaryColor: getMermaidColor("--mermaid-secondary"),
            tertiaryColor: getMermaidColor("--surface"),
            fontFamily: "Arial, Helvetica, sans-serif"
          }
        });

        const result = await mermaid.render(diagramId, chart);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : "Mermaid could not render this diagram.");
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  if (error) {
    return (
      <pre className="mt-4 overflow-x-auto rounded border border-danger-border bg-danger-surface-muted p-4 text-xs leading-5 text-danger-foreground-strong">
        {error}
      </pre>
    );
  }

  return (
    <div
      aria-label={title}
      className="mermaid-surface mt-4 overflow-x-auto rounded border border-border-subtle bg-surface p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
    />
  );
}
