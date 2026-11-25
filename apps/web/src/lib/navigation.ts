import type { Permission } from "@sci/contracts";
import {
  Activity,
  BookOpen,
  Building2,
  ClipboardList,
  Gauge,
  HeartPulse,
  LineChart,
  Plug,
  Radar,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  /** Etapa do roadmap em que o módulo passa a ter funcionalidade real. */
  stage: number;
  description: string;
}

export const NAV: NavItem[] = [
  {
    href: "/app/dashboard",
    label: "Dashboard Executivo",
    icon: Gauge,
    permission: "reports.read",
    stage: 1,
    description: "Visão consolidada da carteira.",
  },
  {
    href: "/app/carteira",
    label: "Carteira de Clientes",
    icon: Building2,
    permission: "customers.read",
    stage: 1,
    description: "Clientes, contatos e histórico.",
  },
  {
    href: "/app/calls",
    label: "Assistente de Calls",
    icon: Activity,
    permission: "meetings.read",
    stage: 3,
    description: "Reuniões acompanhadas pelo Scale Assistant.",
  },
  {
    href: "/app/playbooks",
    label: "Playbooks e Conhecimento",
    icon: BookOpen,
    permission: "playbooks.read",
    stage: 2,
    description: "Metodologia da sua empresa e skill de CS.",
  },
  {
    href: "/app/health",
    label: "Customer Health",
    icon: HeartPulse,
    permission: "analyses.read",
    stage: 1,
    description: "Saúde de cada cliente com fatores explicáveis.",
  },
  {
    href: "/app/churn",
    label: "Churn Radar",
    icon: Radar,
    permission: "analyses.read",
    stage: 1,
    description: "Sinais de risco identificados nas reuniões.",
  },
  {
    href: "/app/expansao",
    label: "Oportunidades de Expansão",
    icon: TrendingUp,
    permission: "analyses.read",
    stage: 1,
    description: "Upsell, cross-sell e novas necessidades.",
  },
  {
    href: "/app/planos",
    label: "Planos de Ação",
    icon: ClipboardList,
    permission: "action_plans.read",
    stage: 1,
    description: "Tarefas geradas a partir das análises.",
  },
  {
    href: "/app/relatorios",
    label: "Relatórios e Indicadores",
    icon: LineChart,
    permission: "reports.read",
    stage: 1,
    description: "Evolução da carteira e exportações.",
  },
  {
    href: "/app/integracoes",
    label: "Integrações",
    icon: Plug,
    permission: "integrations.read",
    stage: 7,
    description: "Bitrix24, Pipedrive, RD Station CRM e Zoho CRM.",
  },
  {
    href: "/app/configuracoes",
    label: "Configurações",
    icon: Settings,
    permission: "users.read",
    stage: 1,
    description: "Usuários, papéis, permissões e auditoria.",
  },
];
