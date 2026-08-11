import { redirect } from "next/navigation";

type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : []) {
      params.append(key, item);
    }
  }

  redirect(params.size ? `/?${params.toString()}` : "/");
}
