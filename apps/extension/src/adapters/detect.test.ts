import { describe, expect, it } from "vitest";
import { detectFromUrl, meetingTitle } from "./detect.js";

describe("detecção de reunião por plataforma", () => {
  it("Google Meet", () => {
    expect(detectFromUrl("https://meet.google.com/abc-defg-hij?authuser=0")).toEqual({
      platform: "google_meet",
      externalRef: "abc-defg-hij",
      desktopHandoff: false,
      inMeeting: true,
    });
    expect(detectFromUrl("https://meet.google.com/landing")?.inMeeting).toBe(false);
  });

  it("Zoom: cliente web x página que abre o app desktop", () => {
    expect(detectFromUrl("https://app.zoom.us/wc/81234567890/join?fromPWA=1")).toMatchObject({
      platform: "zoom",
      externalRef: "81234567890",
      inMeeting: true,
      desktopHandoff: false,
    });
    expect(detectFromUrl("https://us02web.zoom.us/j/81234567890?pwd=x")).toMatchObject({
      desktopHandoff: true,
      inMeeting: false,
    });
  });

  it("Teams: link de reunião e launcher do app", () => {
    const r = detectFromUrl(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d",
    );
    expect(r).toMatchObject({ platform: "teams", externalRef: "19:meeting_abc@thread.v2", inMeeting: true });
    expect(detectFromUrl("https://teams.microsoft.com/dl/launcher/launcher.html?url=x")?.desktopHandoff).toBe(
      true,
    );
  });

  it("ignora outros domínios, http e URLs inválidas", () => {
    expect(detectFromUrl("https://meet.google.com.evil.com/abc-defg-hij")).toBeNull();
    expect(detectFromUrl("http://meet.google.com/abc-defg-hij")).toBeNull();
    expect(detectFromUrl("não é url")).toBeNull();
  });

  it("título limpo, sem o código da sala", () => {
    expect(meetingTitle("google_meet", { title: "Meet - Revisão trimestral ACME" } as Document)).toBe(
      "Revisão trimestral ACME",
    );
    expect(meetingTitle("google_meet", { title: "Meet - abc-defg-hij" } as Document)).toBeNull();
    expect(meetingTitle("teams", { title: "Reunião de onboarding | Microsoft Teams" } as Document)).toBe(
      "Reunião de onboarding",
    );
  });
});
