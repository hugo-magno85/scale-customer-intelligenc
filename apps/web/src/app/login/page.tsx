"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ErrorText, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", {
        method: "POST",
        tenant: false,
        json: { email: form.get("email"), password: form.get("password") },
      });
      router.replace("/app/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="text-sm font-semibold tracking-wide text-white/70">ACADEMIA SCALE</div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight">Scale Customer Intelligence</h1>
          <p className="mt-4 max-w-md text-lg text-white/70">
            Transforme cada conversa em inteligência para proteger a receita.
          </p>
        </div>
        <p className="text-xs text-white/50">
          Cada reunião gera inteligência. Cada diagnóstico orienta uma ação.
        </p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-semibold">Entrar</h2>
            <p className="mt-1 text-sm text-ink-soft">Acesse a sua carteira e as análises das reuniões.</p>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <Input label="E-mail" name="email" type="email" autoComplete="email" required />
          <Input label="Senha" name="password" type="password" autoComplete="current-password" required />
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </section>
    </main>
  );
}
