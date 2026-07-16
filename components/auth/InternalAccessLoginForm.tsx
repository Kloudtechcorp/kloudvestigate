"use client";

import { useActionState } from "react";
import { LockKeyhole } from "lucide-react";
import { loginWithInternalAccess, type LoginState } from "@/app/login/actions";

type InternalAccessLoginFormProps = {
  nextPath: string;
};

const initialState: LoginState = {};

export function InternalAccessLoginForm({ nextPath }: InternalAccessLoginFormProps) {
  const [state, action, pending] = useActionState(loginWithInternalAccess, initialState);

  return (
    <form action={action} className="grid gap-4">
      <input name="next" type="hidden" value={nextPath} />
      <label className="field-label" htmlFor="password">
        Internal password
      </label>
      <input
        autoComplete="current-password"
        autoFocus
        className="field"
        id="password"
        name="password"
        required
        type="password"
      />
      {state.error ? (
        <p className="rounded-[4px] bg-danger-bg px-3 py-2 text-sm font-medium text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="primary-action inline-flex items-center justify-center gap-2" disabled={pending} type="submit">
        <LockKeyhole aria-hidden="true" className="h-4 w-4" />
        {pending ? "Checking..." : "Unlock"}
      </button>
    </form>
  );
}
