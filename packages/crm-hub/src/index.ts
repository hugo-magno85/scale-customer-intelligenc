export * from "./references.js";
export * from "./http.js";
export * from "./providers.js";
export * from "./bitrix24.js";
export * from "./pipedrive.js";

import { bitrixFactory, parseBitrixWebhook } from "./bitrix24.js";
import { pipedriveCredentialError, pipedriveFactory } from "./pipedrive.js";
import { registerCrmClient } from "./providers.js";
registerCrmClient("bitrix24", bitrixFactory);
registerCrmClient("pipedrive", pipedriveFactory);

/** Confere o formato da credencial antes de gravar (sem chamar o CRM). Devolve a mensagem de erro, se houver. */
export function credentialFormatError(
  provider: string,
  authType: string,
  account: string,
  secret: string,
): string | null {
  if (provider === "bitrix24") {
    if (authType !== "webhook") return "No momento o Bitrix24 funciona com webhook de entrada";
    try {
      parseBitrixWebhook(secret, account);
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (provider === "pipedrive") return pipedriveCredentialError(authType, secret);
  return null;
}
