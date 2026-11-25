// Página aberta uma única vez para o Chrome registrar a permissão de microfone da extensão.
const btn = document.getElementById("grant") as HTMLButtonElement;
const out = document.getElementById("result") as HTMLParagraphElement;
btn.onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    out.textContent = "Microfone autorizado. Você já pode fechar esta aba.";
  } catch {
    out.textContent =
      "Permissão negada. Libere o microfone nas configurações do Chrome para o Scale Assistant.";
  }
};
