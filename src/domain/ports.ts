import type { EstadoProjeto, EventoRecomendacao, Notificacao, ProfissionalDados } from './model.js';

export const OBSERVADORES = ['auditoria', 'interno', 'email', 'integracao', 'composicao'];
export interface ProcessadorEventos { processar(): Promise<void> }
export interface PublicadorIntegracao { publicar(destino: string, evento: EventoRecomendacao): Promise<void> }
export interface RepositorioProfissionais {
  listarProfissionais(): Promise<ProfissionalDados[]>;
  salvarProfissional(p: ProfissionalDados, evento: EventoRecomendacao): Promise<void>;
}
export interface Repositorio extends RepositorioProfissionais {
  obterProjeto(id: string): Promise<EstadoProjeto | undefined>;
  salvarProjeto(estado: EstadoProjeto, versaoEsperada: number, eventos: EventoRecomendacao[]): Promise<void>;
  salvarEventos(eventos: EventoRecomendacao[]): Promise<void>;
  eventos(pendentes?: boolean, observadores?: string[]): Promise<EventoRecomendacao[]>;
  confirmarEntrega(eventoId: string, observador: string): Promise<void>;
  registrarAuditoria(evento: EventoRecomendacao): Promise<void>;
  auditoria(projetoId?: string): Promise<EventoRecomendacao[]>;
  salvarNotificacao(n: Notificacao): Promise<void>;
  notificacoes(destinatarioId?: string): Promise<Notificacao[]>;
  registrarIntegracao(evento: EventoRecomendacao, destino: string): Promise<void>;
  integracoes(): Promise<{ eventoId: string; destino: string; dados: Record<string, unknown> }[]>;
  saudavel(): Promise<boolean>;
}
export interface Logger {
  info(obj: unknown, mensagem?: string): void;
  error(obj: unknown, mensagem?: string): void;
}
