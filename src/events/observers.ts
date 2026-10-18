import { EventEmitter } from 'node:events';
import type { EventoRecomendacao, Notificacao } from '../domain/model.js';
import type { Logger, PublicadorIntegracao, Repositorio } from '../domain/ports.js';

export interface Observador { nome: string; atualizar(evento: EventoRecomendacao): Promise<void> }
export interface EnviadorEmail { enviar(destino: string, assunto: string, texto: string): Promise<void> }
export class AuditoriaRecomendacao implements Observador {
  readonly nome = 'auditoria';
  constructor(private readonly repo: Repositorio, private readonly logger: Logger) {}
  async atualizar(evento: EventoRecomendacao): Promise<void> {
    await this.repo.registrarAuditoria(evento);
    this.logger.info({ eventoId: evento.id, tipo: evento.tipo, projetoId: evento.projetoId, origem: evento.origem }, 'acao_registrada');
  }
}
export class NotificadorInterno implements Observador {
  readonly nome = 'interno';
  constructor(private readonly repo: Repositorio) {}
  async atualizar(evento: EventoRecomendacao): Promise<void> {
    for (const d of evento.destinatarios) await this.repo.salvarNotificacao({
      id: `${evento.id}:interno:${d.id}`, eventoId: evento.id, destinatarioId: d.id,
      canal: 'interno', destino: d.id, mensagem: `${evento.tipo}: projeto ${evento.projetoId}`, status: 'registrada',
    });
  }
}
export class NotificadorEmail implements Observador {
  readonly nome = 'email';
  constructor(private readonly repo: Repositorio, private readonly enviador?: EnviadorEmail) {}
  async atualizar(evento: EventoRecomendacao): Promise<void> {
    for (const d of evento.destinatarios) {
      const n: Notificacao = { id: `${evento.id}:email:${d.id}`, eventoId: evento.id, destinatarioId: d.id,
        canal: 'email', destino: d.email, mensagem: `${evento.tipo}: projeto ${evento.projetoId}`, status: 'registrada' };
      if (this.enviador) {
        const existente = (await this.repo.notificacoes(d.id)).find(x => x.id === n.id);
        if (existente?.status === 'enviada') continue;
        await this.enviador.enviar(d.email, 'Cinebridge', n.mensagem);
        n.status = 'enviada';
      }
      await this.repo.salvarNotificacao(n);
    }
  }
}
export class IntegracaoEquipe implements Observador {
  readonly nome = 'integracao';
  constructor(private readonly repo: Repositorio, private readonly publicador?: PublicadorIntegracao) {}
  async atualizar(evento: EventoRecomendacao): Promise<void> {
    if (evento.tipo !== 'EQUIPE_FORMADA') return;
    for (const destino of ['gerenciamento-projetos', 'processamento-financeiro']) {
      if (this.publicador) await this.publicador.publicar(destino, evento);
      await this.repo.registrarIntegracao(evento, destino);
    }
  }
}
export class ObservadorComposicao implements Observador {
  readonly nome = 'composicao';
  constructor(private readonly aplicar: (evento: EventoRecomendacao) => Promise<void>) {}
  async atualizar(evento: EventoRecomendacao): Promise<void> { await this.aplicar(evento); }
}
export class EventosEmMemoria {
  private readonly emitter = new EventEmitter();
  private readonly observadores: Observador[] = [];
  private processamento?: Promise<void>;
  private novaPassagem = false;
  constructor(private readonly repo: Repositorio, private readonly logger: Logger) {}
  adicionarObservador(observador: Observador): void {
    if (this.observadores.some(o => o.nome === observador.nome)) throw new Error('Observador duplicado.');
    this.observadores.push(observador);
    this.emitter.on(observador.nome, (evento: EventoRecomendacao, concluir: (p: Promise<void>) => void) => concluir(observador.atualizar(evento)));
  }
  processar(): Promise<void> {
    this.novaPassagem = true;
    if (this.processamento) return this.processamento;
    this.processamento = this.drenar().finally(() => { this.processamento = undefined; });
    return this.processamento;
  }
  private async drenar(): Promise<void> {
    const tentados = new Set<string>();
    do {
      this.novaPassagem = false;
      await this.entregar(tentados);
    } while (this.novaPassagem);
  }
  private async entregar(tentados: Set<string>): Promise<void> {
    try {
      while (true) {
        const pendentes = (await this.repo.eventos(true, this.observadores.map(o => o.nome))).filter(e => !tentados.has(e.id));
        if (!pendentes.length) return;
        for (const evento of pendentes) {
          // Eventos novos entram na próxima consulta; falhas só repetem no próximo ciclo.
          tentados.add(evento.id);
          // Uma falha não impede os outros observadores de receberem o evento.
          await Promise.all(this.observadores.filter(o => !evento.entregues.includes(o.nome)).map(async o => {
            try {
              await new Promise<void>((resolve, reject) => {
                this.emitter.emit(o.nome, evento, (p: Promise<void>) => { p.then(resolve, reject); });
              });
              await this.repo.confirmarEntrega(evento.id, o.nome);
            } catch (erro) { this.logger.error({ erro, eventoId: evento.id, observador: o.nome }, 'Entrega pendente; será tentada novamente'); }
          }));
        }
      }
    } catch (erro) { this.logger.error({ erro }, 'Não foi possível consultar os eventos pendentes'); }
  }
}
