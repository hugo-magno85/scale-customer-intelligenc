declare const __SCI_API_URL__: string;
declare const __SCI_WEB_URL__: string;

export const API_URL: string =
  typeof __SCI_API_URL__ !== "undefined" ? __SCI_API_URL__ : "http://localhost:4000";
export const WEB_URL: string =
  typeof __SCI_WEB_URL__ !== "undefined" ? __SCI_WEB_URL__ : "http://localhost:3000";
