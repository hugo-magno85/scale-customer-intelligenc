import { detectFromUrl, extractParticipants, meetingTitle } from "./adapters/detect.js";
import type { DetectedMeeting, RuntimeMessage } from "./shared/messages.js";

// Content script: SOMENTE leitura de metadados visíveis (URL, título, nomes).
// Não captura áudio nem conteúdo da conversa.
let last = "";

function report() {
  const d = detectFromUrl(location.href);
  if (!d) return;
  const meeting: DetectedMeeting = {
    platform: d.platform,
    externalRef: d.externalRef,
    title: meetingTitle(d.platform, document),
    participants: d.inMeeting ? extractParticipants(d.platform, document) : [],
    url: location.origin + location.pathname,
    desktopHandoff: d.desktopHandoff,
  };
  const key = JSON.stringify(meeting);
  if (key === last) return;
  last = key;
  const msg: RuntimeMessage = { type: "sci:meeting-detected", meeting };
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

report();
// SPAs: a URL e a lista de participantes mudam sem recarregar a página
setInterval(report, 5000);
