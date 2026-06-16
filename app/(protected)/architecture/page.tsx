import architectureData from "@/docs/project-architecture.json";
import { PageShell } from "@/components/layout/PageShell";
import { MermaidDiagram } from "@/components/architecture/MermaidDiagram";
import type { ReactNode } from "react";

type ArchitectureData = typeof architectureData;

const data = architectureData as ArchitectureData;

export default function ArchitecturePage() {
  return (
    <PageShell
      eyebrow="System design"
      title="Telemetry Investigation Architecture"
      description={data.project.summary}
      maxWidth="narrow"
    >
      <article className="text-sm leading-7 text-text-primary">
        <Section title="Project">
          <ul className="list-inside list-disc space-y-1 text-text-secondary">
            <li>{data.project.purpose}</li>
            <li>{data.project.framework}</li>
            <li>
              Architecture source: <code className="font-mono text-xs bg-bg-raised px-1 py-0.5">docs/project-architecture.json</code>
            </li>
          </ul>
        </Section>

        <Section title="Runtime">
          <div className="grid gap-6 md:grid-cols-2">
            <InfoList title="Client Side" items={data.runtime.client} />
            <InfoList title="Server Side" items={data.runtime.server} />
          </div>
        </Section>

        <Section title="Diagrams">
          <div className="grid gap-6">
            {data.diagrams.map((diagram) => (
              <figure className="rounded-[6px] border border-border bg-bg-surface p-6" key={diagram.id}>
                <figcaption className="mb-2 text-xs text-text-muted">{diagram.title}: {diagram.description}</figcaption>
                <MermaidDiagram chart={diagram.mermaid} title={diagram.title} />
              </figure>
            ))}
          </div>
        </Section>

        <Section title="Major Modules">
          <div className="overflow-x-auto rounded-[6px] border border-border bg-bg-surface">
            <table className="ops-table min-w-[680px] text-xs">
              <thead>
                <tr>
                  <th className="w-[160px]">Module</th>
                  <th className="w-[240px]">File(s)</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {data.majorModules.map((module) => (
                  <tr key={module.name}>
                    <td className="font-medium text-text-primary">{module.name}</td>
                    <td className="font-mono text-text-muted">{module.paths.join(", ")}</td>
                    <td className="text-text-secondary">{module.responsibility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Security">
          <ul className="list-inside list-disc space-y-1 text-text-secondary">
            {data.security.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Section>

        <Section title="Environment">
          <ul className="list-inside list-disc space-y-1 text-text-secondary">
            {data.environment.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Section>

        <Section title="Future Work">
          <ul className="list-inside list-disc space-y-1 text-text-secondary">
            {data.futureWork.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Section>

        <p className="mt-10 border-t border-border pt-4 text-xs text-text-muted">
          Kloudvestigate telemetry monitoring platform.
        </p>
      </article>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 border-b border-border pb-1 text-sm font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
      <ul className="list-inside list-disc space-y-1 text-text-secondary">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
