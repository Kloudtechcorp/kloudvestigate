import architectureData from "@/docs/project-architecture.json";
import { PageShell } from "@/components/layout/PageShell";
import { MermaidDiagram } from "@/components/architecture/MermaidDiagram";

type ArchitectureData = typeof architectureData;

const data = architectureData as ArchitectureData;

export default function ArchitecturePage() {
  return (
    <PageShell
      eyebrow="System design"
      title="Telemetry Copilot Architecture"
      description={data.project.tokenSavingSummary}
    >
      <div className="grid gap-4">
        <section className="grid gap-4 lg:grid-cols-3">
          <Info title="Project" items={[
            data.project.purpose,
            data.project.framework,
            `Architecture source: docs/project-architecture.json`,
          ]} />
          <Info title="Client Side" items={data.runtime.client} />
          <Info title="Server Side" items={data.runtime.server} />
        </section>

        <section className="mt-4 grid gap-4">
          {data.diagrams.map((diagram) => (
            <div className="panel" key={diagram.id}>
              <div className="flex flex-col gap-1">
                <h2 className="panel-title">{diagram.title}</h2>
                <p className="text-sm leading-6 text-muted-foreground">{diagram.description}</p>
              </div>
              <MermaidDiagram chart={diagram.mermaid} title={diagram.title} />
            </div>
          ))}
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="panel">
            <h2 className="panel-title">Major Modules</h2>
            <div className="mt-4 grid gap-3">
              {data.majorModules.map((module) => (
                <div className="rounded border border-border-subtle bg-surface p-3" key={module.name}>
                  <h3 className="font-semibold text-heading">{module.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-body-copy">{module.responsibility}</p>
                  <p className="mt-2 font-mono text-xs leading-5 text-code-foreground">{module.paths.join(", ")}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <Info title="Security" items={data.security} />
            <Info title="Environment" items={data.environment} />
          </div>
        </section>

        <section className="mt-4 grid gap-4">
          <div className="panel">
            <h2 className="panel-title">Future Work</h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-body-copy">
              {data.futureWork.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function Info({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel">
      <h2 className="panel-title">{title}</h2>
      <ul className="mt-3 grid gap-2 text-sm leading-6 text-body-copy">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
