"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ErrorText } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/** IDs autorizados da extensão Scale Assistant (lista separada por vírgula). */
const ALLOWED = (process.env.NEXT_PUBLIC_EXTENSION_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type ChromeRuntime = {
  sendMessage: (
    id: string,
    msg: unknown,
    cb: (r: { ok?: boolean; error?: string } | undefined) => void,
  ) => void;
  lastError?: { message?: string };
};

export default function ConnectExtensionPage() {
  const [ext, setExt] = useState<string | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "sent" | "error">("checking");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("ext");
    if (!id || !/^[a-p]{32}$/.test(id) || !ALLOWED.includes(id)) {
      setState("error");
      setMsg("Extensão não reconhecida. Instale o Scale Assistant oficial e abra esta página a partir dele.");
      return;
    }
    setExt(id);
    api("/auth/me", { tenant: false })
      .then(() => setState("ready"))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401)
          location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        else {
          setState("error");
          setMsg((e as Error).message);
        }
      });
  }, []);

  async function connect() {
    const runtime = (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
    if (!runtime?.sendMessage || !ext) {
      setState("error");
      setMsg(
        "Não foi possível falar com a extensão. Verifique se o Scale Assistant está instalado neste navegador.",
      );
      return;
    }
    try {
      const t = await api<{ token: string; expiresAt: string }>("/auth/extension-token", {
        method: "POST",
        tenant: false,
      });
      runtime.sendMessage(ext, { type: "sci:auth", token: t.token, expiresAt: t.expiresAt }, (r) => {
        if (r?.ok) setState("sent");
        else {
          setState("error");
          setMsg(r?.error ?? runtime.lastError?.message ?? "A extensão recusou a conexão.");
        }
      });
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full space-y-4">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-soft">SCALE ASSISTANT</div>
        <h1 className="text-xl font-semibold">Conectar a extensão</h1>
        <p className="text-sm text-ink-soft">
          A extensão receberá um acesso próprio, que pode ser revogado a qualquer momento. As chaves de IA e
          de CRM nunca saem do servidor.
        </p>
        {state === "ready" && <Button onClick={() => void connect()}>Autorizar Scale Assistant</Button>}
        {state === "sent" && (
          <p className="text-sm font-medium text-healthy">
            Pronto! Volte para a reunião e abra o painel do Scale Assistant.
          </p>
        )}
        {state === "error" && msg && <ErrorText>{msg}</ErrorText>}
        <Link href="/app/dashboard" className="block text-sm text-ink-soft hover:text-ink">
          Ir para a plataforma
        </Link>
      </Card>
    </main>
  );
}
