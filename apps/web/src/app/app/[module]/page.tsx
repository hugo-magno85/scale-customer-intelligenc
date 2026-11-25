"use client";

import { useParams } from "next/navigation";
import { Empty, PageHeader } from "@/components/ui";
import { NAV } from "@/lib/navigation";

export default function ModulePage() {
  const { module } = useParams<{ module: string }>();
  const item = NAV.find((n) => n.href === `/app/${module}`);
  if (!item) return <Empty title="Módulo não encontrado" />;
  return (
    <>
      <PageHeader title={item.label} subtitle={item.description} />
      <Empty title={`Disponível na Etapa ${item.stage} do roadmap`}>
        Este módulo será liberado quando a etapa correspondente for concluída e validada. Nenhum dado de
        exemplo é exibido.
      </Empty>
    </>
  );
}
