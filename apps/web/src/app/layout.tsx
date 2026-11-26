import type { Metadata } from "next";
import "./globals.css";

/**
 * Páginas sempre geradas na hora (Cache-Control: no-store). Sem isso o Next marca o HTML como
 * cacheável por 1 ano (s-maxage) e proxies na frente do servidor continuam entregando a versão
 * antiga depois de um deploy. Os arquivos em /_next/static têm hash no nome e seguem com cache longo.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scale Customer Intelligence",
  description: "Transforme cada conversa em inteligência para proteger a receita.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
