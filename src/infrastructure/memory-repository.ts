import { ErroDominio, type EstadoProjeto, type EventoRecomendacao, type Notificacao, type ProfissionalDados } from '../domain/model.js';
import { OBSERVADORES, type Repositorio } from '../domain/ports.js';

// Repositório isolado para testes. O servidor sempre usa PostgreSQL.
export class RepositorioMemoria implements Repositorio {
  profissionais = new Map<string, ProfissionalDados>();
  projetos = new Map<string, EstadoProjeto>();
  fila = new Map<string, EventoRecomendacao>();
  registros = new Map<string, EventoRecomendacao>();
  mensagens = new Map<string, Notificacao>();
  encaminhados = new Map<string, { eventoId: string; destino: string; dados: Record<string, unknown> }>();
  async listarProfissionais(): Promise<ProfissionalDados[]> { return structuredClone([...this.profissionais.values()]); }
  async salvarProfissional(p: ProfissionalDados, evento: EventoRecomendacao): Promise<void> {
    this.profissionais.set(p.id, structuredClone(p)); this.fila.set(evento.id, structuredClone(evento));
  }
  async obterProjeto(id: string): Promise<EstadoProjeto | undefined> { return structuredClone(this.projetos.get(id)); }
  async salvarProjeto(estado: EstadoProjeto, versao: number, eventos: EventoRecomendacao[]): Promise<void> {
    if ((this.projetos.get(estado.projeto.id)?.versao ?? 0) !== versao) throw new ErroDominio('Projeto alterado por outra solicitação. Consulte novamente e tente outra vez.', 409);
    this.projetos.set(estado.projeto.id, structuredClone(estado));
    for (const e of eventos) this.fila.set(e.id, structuredClone(e));
  }
  async salvarEventos(eventos: EventoRecomendacao[]): Promise<void> {
    for (const e of eventos) this.fila.set(e.id, structuredClone(e));
  }
  async eventos(pendentes = false, observadores = OBSERVADORES): Promise<EventoRecomendacao[]> {
    return structuredClone([...this.fila.values()].filter(e => !pendentes || observadores.some(o => !e.entregues.includes(o))));
  }
  async confirmarEntrega(eventoId: string, observador: string): Promise<void> {
    const evento = this.fila.get(eventoId)!;
    if (!evento.entregues.includes(observador)) evento.entregues.push(observador);
  }
  async registrarAuditoria(e: EventoRecomendacao): Promise<void> { this.registros.set(e.id, structuredClone(e)); }
  async auditoria(projetoId?: string): Promise<EventoRecomendacao[]> { return structuredClone([...this.registros.values()].filter(e => !projetoId || e.projetoId === projetoId)); }
  async salvarNotificacao(n: Notificacao): Promise<void> { this.mensagens.set(n.id, structuredClone(n)); }
  async notificacoes(destinatarioId?: string): Promise<Notificacao[]> { return structuredClone([...this.mensagens.values()].filter(n => !destinatarioId || n.destinatarioId === destinatarioId)); }
  async registrarIntegracao(evento: EventoRecomendacao, destino: string): Promise<void> {
    this.encaminhados.set(`${evento.id}:${destino}`, { eventoId: evento.id, destino, dados: structuredClone(evento.dados) });
  }
  async integracoes(): Promise<{ eventoId: string; destino: string; dados: Record<string, unknown> }[]> { return structuredClone([...this.encaminhados.values()]); }
  async saudavel(): Promise<boolean> { return true; }
}
