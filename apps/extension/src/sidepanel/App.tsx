import {
  MEETING_PLATFORM_LABELS,
  MEETING_TYPE_LABELS,
  MEETING_TYPES,
  type ConsentMethod,
  type CurrentUser,
  type Customer,
  type Meeting,
  type MeetingIntelligence,
  type MeetingType,
  type Playbook,
  type StreamServerMessage,
  type StreamTicket,
  type TranscriptSegment,
} from "@sci/contracts";
import { useCallback, useEffect, useState } from "react";
import { WEB_URL } from "../shared/env.js";
import type { DetectedMeeting, RuntimeMessage } from "../shared/messages.js";
import { api, ApiError, getAuth, getTenant, logout, setTenant, wsUrl } from "./api.js";
import { IntelligencePanel } from "./Intelligence.js";
import { CrmLink } from "./CrmLink.js";

type CaptureStatus = "idle" | "connecting" | "live" | "stopped" | "error";

async function activeTabId(): Promise<number | null> {
  // `?tabId=` permite abrir o painel como aba comum (diagnóstico e testes automatizados)
  const forced = Number(new URLSearchParams(location.search).get("tabId"));
  if (Number.isInteger(forced) && forced > 0) return forced;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function Connect() {
  return (
    <div className="wrap">
      <div className="card stack">
        <div className="title">Conecte o Scale Assistant</div>
        <p className="muted">
          Entre na plataforma Scale Customer Intelligence e autorize esta extensão. Nenhuma senha é guardada
          aqui.
        </p>
        <button
          className="btn"
          onClick={() => chrome.tabs.create({ url: `${WEB_URL}/extensao/conectar?ext=${chrome.runtime.id}` })}
        >
          Conectar com a plataforma
        </button>
      </div>
    </div>
  );
}

function Prepare({
  detected,
  onCreated,
}: {
  detected: DetectedMeeting | null;
  onCreated: (m: Meeting) => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [playbookId, setPlaybookId] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("follow_up");
  const [objective, setObjective] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Playbook[]>("/playbooks")
      .then((p) => setPlaybooks(p.filter((x) => x.active && x.publishedVersionId)))
      .catch(() => setPlaybooks([]));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ items: Customer[] }>(`/customers?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => setCustomers(r.items))
        .catch(() => setCustomers([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const pb = playbooks.find((p) => p.id === playbookId);
    if (pb) setMeetingType(pb.meetingType);
  }, [playbookId, playbooks]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Meeting>("/meetings", {
        json: {
          platform: detected?.platform ?? "other",
          externalRef: detected?.externalRef ?? null,
          title: detected?.title ?? null,
          meetingType,
          objective: objective || null,
          customerId: customerId || null,
          playbookId: playbookId || null,
          participants: (detected?.participants ?? []).map((n) => ({
            displayName: n,
            role: "unknown",
            source: "platform",
          })),
        },
      });
      onCreated(m);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="title">Preparação</div>
      <label>
        Cliente <span className="muted">(opcional — pode vincular depois)</span>
        <input placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Sem cliente vinculado</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Playbook
        <select value={playbookId} onChange={(e) => setPlaybookId(e.target.value)}>
          <option value="">Sem playbook (apenas skill de CS)</option>
          {playbooks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · v{p.publishedVersionNumber}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tipo de reunião
        <select value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)}>
          {MEETING_TYPES.map((t) => (
            <option key={t} value={t}>
              {MEETING_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Objetivo da reunião
        <textarea
          rows={2}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Ex.: entender a baixa adoção e combinar plano"
        />
      </label>
      {detected && detected.participants.length > 0 && (
        <p className="muted">Participantes identificados: {detected.participants.join(", ")}</p>
      )}
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={busy} onClick={() => void create()}>
        {busy ? "Preparando…" : "Preparar reunião"}
      </button>
    </div>
  );
}

function Live({ meeting, setMeeting }: { meeting: Meeting; setMeeting: (m: Meeting | null) => void }) {
  const [method, setMethod] = useState<ConsentMethod>("verbal_announcement");
  const [informed, setInformed] = useState(false);
  const [status, setStatus] = useState<CaptureStatus>(meeting.status === "live" ? "stopped" : "idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState<{ speaker: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [intel, setIntel] = useState<MeetingIntelligence | null>(null);

  useEffect(() => {
    api<TranscriptSegment[]>(`/meetings/${meeting.id}/transcript`)
      .then(setSegments)
      .catch(() => undefined);
    api<MeetingIntelligence>(`/meetings/${meeting.id}/intelligence`)
      .then(setIntel)
      .catch(() => undefined);
    const listener = (msg: RuntimeMessage) => {
      if (msg.type === "capture:status") {
        setStatus(msg.status);
        setStatusMsg(msg.message ?? null);
      }
      if (msg.type === "capture:server-message") {
        const p = msg.payload as StreamServerMessage;
        if (p.type === "segment") {
          setSegments((s) => [...s, p.segment]);
          setInterim(null);
        } else if (p.type === "interim") setInterim({ speaker: p.speaker, text: p.text });
        else if (p.type === "error") setErr(p.message);
        else if (p.type === "intelligence") setIntel(p.state);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [meeting.id]);

  // Sem captura nesta aba (ex.: outra pessoa/dispositivo capturando), mantém a inteligência atualizada
  useEffect(() => {
    if (status === "live" || meeting.status === "ended") return;
    const t = setInterval(() => {
      api<MeetingIntelligence>(`/meetings/${meeting.id}/intelligence`)
        .then(setIntel)
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [status, meeting.id, meeting.status]);

  async function confirmConsent() {
    try {
      setMeeting(
        await api<Meeting>(`/meetings/${meeting.id}/consent`, { json: { method, confirmed: true } }),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function startCapture() {
    setErr(null);
    try {
      const tabId = await activeTabId();
      if (tabId == null) throw new Error("Abra a aba da reunião");
      const t = await api<StreamTicket>(`/meetings/${meeting.id}/stream-ticket`, { json: {} });
      const r = (await chrome.runtime.sendMessage({
        type: "sci:start-capture",
        tabId,
        wsUrl: wsUrl(t.wsPath, t.ticket),
      } satisfies RuntimeMessage)) as { ok: boolean; error?: string };
      if (!r?.ok) throw new Error(r?.error ?? "Não foi possível iniciar a captura");
      setStatus("connecting");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function stopCapture() {
    await chrome.runtime.sendMessage({ type: "sci:stop-capture" } satisfies RuntimeMessage);
    setStatus("stopped");
  }

  async function end() {
    await stopCapture();
    setMeeting(await api<Meeting>(`/meetings/${meeting.id}/end`, { json: {} }));
  }

  const capturing = status === "live" || status === "connecting";
  return (
    <>
      <div className="card stack">
        <div className="row between">
          <div className="title">{meeting.title ?? MEETING_PLATFORM_LABELS[meeting.platform]}</div>
          {capturing ? (
            <span className="pill live">{status === "live" ? "Capturando" : "Conectando"}</span>
          ) : (
            <span className="pill">{meeting.status === "ended" ? "Encerrada" : "Preparada"}</span>
          )}
        </div>
        <dl className="kv">
          <dt>Cliente</dt>
          <dd>{meeting.customerName ?? "Não vinculado"}</dd>
          <dt>Playbook</dt>
          <dd>
            {meeting.playbookName
              ? `${meeting.playbookName} · v${meeting.playbookVersionNumber}`
              : "Apenas skill de CS"}
          </dd>
          <dt>Tipo</dt>
          <dd>{MEETING_TYPE_LABELS[meeting.meetingType]}</dd>
        </dl>
      </div>

      <CrmLink meetingId={meeting.id} />

      {meeting.status !== "ended" && !meeting.consentConfirmedAt && (
        <div className="card stack warn">
          <div className="title">Transparência e consentimento</div>
          <p>
            Antes de capturar, informe os participantes que a reunião será transcrita para apoio ao
            atendimento (LGPD).
          </p>
          <label>
            Como os participantes foram informados
            <select value={method} onChange={(e) => setMethod(e.target.value as ConsentMethod)}>
              <option value="verbal_announcement">Aviso verbal no início da reunião</option>
              <option value="written">Aviso por escrito (convite/e-mail)</option>
              <option value="platform_notice">Aviso da própria plataforma</option>
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={informed}
              onChange={(e) => setInformed(e.target.checked)}
            />
            Confirmo que informei os participantes
          </label>
          <button className="btn" disabled={!informed} onClick={() => void confirmConsent()}>
            Registrar consentimento
          </button>
        </div>
      )}

      {meeting.status !== "ended" && meeting.consentConfirmedAt && (
        <div className="card row between">
          {capturing ? (
            <button className="btn ghost" onClick={() => void stopCapture()}>
              Pausar captura
            </button>
          ) : (
            <button className="btn" onClick={() => void startCapture()}>
              Iniciar captura
            </button>
          )}
          <button className="btn danger" onClick={() => void end()}>
            Encerrar reunião
          </button>
        </div>
      )}
      {statusMsg && <p className={status === "error" ? "error" : "muted"}>{statusMsg}</p>}
      {err && <p className="error">{err}</p>}

      {meeting.status !== "ended" && (
        <IntelligencePanel
          meetingId={meeting.id}
          playbookVersionId={meeting.playbookVersionId}
          state={intel}
          setState={setIntel}
          canAct
        />
      )}

      <div className="card stack">
        <div className="brand">TRANSCRIÇÃO</div>
        <div className="transcript">
          {segments.length === 0 && !interim && (
            <p className="muted">A transcrição aparece aqui quando a captura estiver ativa.</p>
          )}
          {segments.map((s) => (
            <div key={s.id} className={`seg ${s.speaker}`}>
              <b>{s.speaker === "customer" ? "Cliente" : "Você"}</b>
              {s.text}
            </div>
          ))}
          {interim && (
            <div className={`seg interim ${interim.speaker}`}>
              <b>{interim.speaker === "customer" ? "Cliente" : "Você"}</b>
              {interim.text}
            </div>
          )}
        </div>
      </div>
      {meeting.status === "ended" && (
        <button className="btn ghost" onClick={() => setMeeting(null)}>
          Nova reunião
        </button>
      )}
    </>
  );
}

export function App() {
  const [state, setState] = useState<"loading" | "anon" | "ready">("loading");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedMeeting | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [meeting, setMeetingState] = useState<Meeting | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!(await getAuth())) return setState("anon");
    try {
      const me = await api<CurrentUser>("/auth/me", { tenant: false });
      setUser(me);
      const saved = await getTenant();
      const t =
        me.memberships.find((m) => m.tenantId === saved)?.tenantId ?? me.memberships[0]?.tenantId ?? null;
      if (t) await setTenant(t);
      setTenantId(t);
      setState("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState("anon");
      else setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.auth) void load();
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [load]);

  // Reunião detectada na aba ativa + reunião em andamento associada à aba
  useEffect(() => {
    if (state !== "ready") return;
    const refresh = async () => {
      const id = await activeTabId();
      setTabId(id);
      if (id == null) return;
      setDetected(
        (await chrome.runtime.sendMessage({
          type: "sci:get-detected",
          tabId: id,
        } satisfies RuntimeMessage)) as DetectedMeeting | null,
      );
      const key = `meeting:${id}`;
      const stored = (await chrome.storage.session.get(key))[key] as string | undefined;
      if (stored && !meeting)
        api<Meeting>(`/meetings/${stored}`)
          .then(setMeetingState)
          .catch(() => undefined);
    };
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [state, meeting]);

  const setMeeting = (m: Meeting | null) => {
    setMeetingState(m);
    if (tabId != null) {
      const key = `meeting:${tabId}`;
      void (m && m.status !== "ended"
        ? chrome.storage.session.set({ [key]: m.id })
        : chrome.storage.session.remove(key));
    }
  };

  if (state === "loading") return <div className="wrap muted">Carregando…</div>;
  if (state === "anon") return <Connect />;
  return (
    <div className="wrap">
      <div className="row between">
        <div>
          <div className="brand">SCALE ASSISTANT</div>
          <div className="muted">{user?.name}</div>
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            void logout().then(() => setState("anon"));
          }}
        >
          Sair
        </button>
      </div>
      {user && user.memberships.length > 1 && (
        <select
          aria-label="Empresa"
          value={tenantId ?? ""}
          onChange={(e) => {
            void setTenant(e.target.value).then(() => {
              setTenantId(e.target.value);
              setMeeting(null);
            });
          }}
        >
          {user.memberships.map((m) => (
            <option key={m.tenantId} value={m.tenantId}>
              {m.tenantName}
            </option>
          ))}
        </select>
      )}
      {err && <p className="error">{err}</p>}
      {detected?.desktopHandoff && (
        <div className="card warn">
          Esta reunião está sendo aberta no aplicativo desktop. A captura funciona apenas na versão web do{" "}
          {MEETING_PLATFORM_LABELS[detected.platform]} — escolha “entrar pelo navegador”.
        </div>
      )}
      {!meeting && !detected && (
        <div className="card muted">
          Abra uma reunião no Google Meet, Zoom (web) ou Microsoft Teams (web). Você também pode preparar uma
          reunião sem detecção automática.
        </div>
      )}
      {!meeting && detected && (
        <div className="card">
          <div className="pill">{MEETING_PLATFORM_LABELS[detected.platform]}</div>{" "}
          <span className="muted">{detected.title ?? detected.externalRef ?? "Reunião detectada"}</span>
        </div>
      )}
      {meeting ? (
        <Live meeting={meeting} setMeeting={setMeeting} />
      ) : (
        <Prepare detected={detected} onCreated={setMeeting} />
      )}
    </div>
  );
}
