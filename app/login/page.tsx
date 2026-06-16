import Image from "next/image";
import { redirect } from "next/navigation";
import { InternalAccessLoginForm } from "@/components/auth/InternalAccessLoginForm";
import { hasInternalAccessSession, isInternalAccessMisconfigured } from "@/lib/auth";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(params.next);

  if (await hasInternalAccessSession()) {
    redirect(nextPath);
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-sm flex-col justify-center">
        <section className="panel grid gap-5">
          <div className="flex items-center gap-3">
            <span className="relative h-9 w-9 overflow-hidden rounded-[6px] bg-bg-raised">
              <Image
                alt=""
                className="object-contain"
                fill
                priority
                sizes="36px"
                src="/kloudvestigate_logo.png"
              />
            </span>
            <div>
              <h1 className="text-base font-semibold text-text-primary">Kloudvestigate</h1>
              <p className="text-sm text-text-secondary">Internal access required</p>
            </div>
          </div>
          {isInternalAccessMisconfigured() ? (
            <p className="rounded-[4px] bg-danger-bg px-3 py-2 text-sm font-medium text-danger" role="alert">
              Set INTERNAL_ACCESS_TOKEN before exposing this deployment.
            </p>
          ) : (
            <InternalAccessLoginForm nextPath={nextPath} />
          )}
        </section>
      </div>
    </main>
  );
}

function normalizeNextPath(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}
