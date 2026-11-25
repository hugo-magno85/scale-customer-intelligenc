import type { MeetingPlatform } from "@sci/contracts";

export interface UrlDetection {
  platform: MeetingPlatform;
  externalRef: string | null;
  /** Página de redirecionamento para o aplicativo desktop (áudio não capturável pela extensão). */
  desktopHandoff: boolean;
  /** A página é uma sala de reunião (não apenas a home da plataforma). */
  inMeeting: boolean;
}

const MEET_CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/;

/**
 * Adaptadores por plataforma — cada uma tem formatos próprios de URL.
 * Não presumir que um mecanismo serve para todas.
 */
export function detectFromUrl(raw: string): UrlDetection | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();

  // Google Meet: https://meet.google.com/abc-defg-hij
  if (host === "meet.google.com") {
    const code = u.pathname.match(MEET_CODE)?.[1] ?? null;
    return { platform: "google_meet", externalRef: code, desktopHandoff: false, inMeeting: !!code };
  }

  // Zoom: cliente web em /wc/<id>/...; /j/<id> é a página que abre o app desktop
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const wc = u.pathname.match(/^\/wc\/(?:join\/)?(\d{9,12})(?:\/|$)/);
    if (wc) return { platform: "zoom", externalRef: wc[1]!, desktopHandoff: false, inMeeting: true };
    const j = u.pathname.match(/^\/[js]\/(\d{9,12})(?:\/|$)/);
    if (j) return { platform: "zoom", externalRef: j[1]!, desktopHandoff: true, inMeeting: false };
    return { platform: "zoom", externalRef: null, desktopHandoff: false, inMeeting: false };
  }

  // Microsoft Teams (trabalho/escola e pessoal)
  if (host === "teams.microsoft.com" || host === "teams.live.com") {
    const join = u.pathname.match(/\/l\/meetup-join\/([^/]+)/);
    const ref = join ? decodeURIComponent(join[1]!).slice(0, 200) : (u.searchParams.get("meetingId") ?? null);
    const launcher = u.pathname.includes("/dl/launcher");
    return {
      platform: "teams",
      externalRef: ref,
      desktopHandoff: launcher,
      inMeeting: !!ref || u.pathname.includes("/meet/"),
    };
  }
  return null;
}

/** Nomes visíveis de participantes — melhor esforço, pois o DOM das plataformas muda sem aviso. */
export function extractParticipants(platform: MeetingPlatform, doc: Document): string[] {
  const names = new Set<string>();
  const add = (s: string | null | undefined) => {
    const v = (s ?? "").replace(/\s+/g, " ").trim();
    if (v && v.length <= 120 && !/^\(?(você|you)\)?$/i.test(v)) names.add(v);
  };
  try {
    if (platform === "google_meet") {
      doc
        .querySelectorAll("[data-participant-id]")
        .forEach((el) =>
          add(el.querySelector("[data-self-name]")?.textContent ?? el.getAttribute("aria-label")),
        );
      doc.querySelectorAll("[data-self-name]").forEach((el) => add(el.textContent));
    } else if (platform === "zoom") {
      doc
        .querySelectorAll(".participants-item__display-name, .video-avatar__avatar-name")
        .forEach((el) => add(el.textContent));
    } else if (platform === "teams") {
      doc
        .querySelectorAll(
          '[data-tid="roster-participant"] [data-tid="displayName"], [data-cid="roster-participant"] span[title]',
        )
        .forEach((el) => add(el.getAttribute("title") ?? el.textContent));
    }
  } catch {
    /* seletores desatualizados não devem quebrar a extensão */
  }
  return [...names].slice(0, 50);
}

export function meetingTitle(platform: MeetingPlatform, doc: Document): string | null {
  const t = doc.title.trim();
  if (!t) return null;
  const cleaned = t
    .replace(/^Meet\s*[-–]\s*/i, "")
    .replace(/\s*\|\s*Microsoft Teams$/i, "")
    .replace(/\s*-\s*Zoom$/i, "")
    .trim();
  if (!cleaned || /^(google meet|zoom|microsoft teams)$/i.test(cleaned)) return null;
  return platform === "google_meet" && MEET_CODE.test(`/${cleaned}`) ? null : cleaned.slice(0, 300);
}
