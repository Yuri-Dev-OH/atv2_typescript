import { NotificadorAnimacao, NotificadorDocumentario, NotificadorFiccao, NotificadorPublicitario, type NotificadorProjeto } from '../events/notificadores-projeto.js';
import { estrategias, RecomendadorPriorizado, type RecomendacaoStrategy } from '../recommendation/strategies.js';
import type { AjustesProjeto, Estrategia, Projeto, RestricoesProjeto, TipoProjeto, VisitanteProjeto } from './model.js';
import { GeradorRelatorio, GeradorRelatorioAnimacao } from './visitors.js';
import type { ProjetoAnimacao, ProjetoDocumentario, ProjetoFiccao, ProjetoPublicitario, RestricoesAnimacao, RestricoesDocumentario, RestricoesPublicitario } from './projetos.js';
import { ValidadorAnimacao, ValidadorDocumentario, ValidadorFiccao, ValidadorPublicitario, type ValidadorProjeto } from './validadores.js';

/**
 * Abstract Factory: cria, de forma coerente, a família de objetos de um tipo de projeto.
 *
 * Trocar a fábrica troca todo o ecossistema (projeto, validador, recomendador e
 * notificador) sem condicionais no orquestrador ou no serviço.
 */
export interface FabricaProjeto {
  readonly tipo: TipoProjeto;
  /** Cria um projeto do tipo, por clonagem do protótipo, aplicando os dados informados. */
  criarProjeto(dados: AjustesProjeto): Projeto;
  criarValidador(): ValidadorProjeto;
  /** @param estrategia Estratégia escolhida pelo produtor (Strategy da atividade 1). */
  criarRecomendador(estrategia: Estrategia): RecomendacaoStrategy;
  criarNotificador(): NotificadorProjeto;
  /** Visitante que gera o relatório do produtor no formato do tipo. */
  criarRelatorio(): VisitanteProjeto<string>;
}

/**
 * Base das fábricas concretas. O projeto nasce do clone do protótipo recebido;
 * validador e notificador são Factory Methods implementados por cada subclasse.
 */
export abstract class FabricaBase<R extends RestricoesProjeto> implements FabricaProjeto {
  protected constructor(private readonly prototipo: Projeto<R>) {}
  get tipo(): TipoProjeto { return this.prototipo.tipo; }
  criarProjeto(dados: AjustesProjeto): Projeto<R> { return this.prototipo.instanciar(dados); }
  criarRecomendador(estrategia: Estrategia): RecomendacaoStrategy {
    return new RecomendadorPriorizado(estrategias[estrategia], this.restricoes().competenciasPrioritarias);
  }
  abstract criarValidador(): ValidadorProjeto;
  abstract criarNotificador(): NotificadorProjeto;
  criarRelatorio(): VisitanteProjeto<string> { return new GeradorRelatorio(); }
  /** Cópia das restrições do protótipo, para que os produtos não as compartilhem. */
  protected restricoes(): R { return structuredClone(this.prototipo.restricoes); }
}
export class FabricaFiccao extends FabricaBase<RestricoesProjeto> {
  constructor(prototipo: ProjetoFiccao) { super(prototipo); }
  // Ficção conserva a estratégia pura da atividade 1, sem priorização de competências.
  override criarRecomendador(estrategia: Estrategia): RecomendacaoStrategy { return estrategias[estrategia]; }
  criarValidador(): ValidadorProjeto { return new ValidadorFiccao(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorFiccao(); }
}
export class FabricaDocumentario extends FabricaBase<RestricoesDocumentario> {
  constructor(prototipo: ProjetoDocumentario) { super(prototipo); }
  criarValidador(): ValidadorProjeto { return new ValidadorDocumentario(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorDocumentario(this.restricoes()); }
}
export class FabricaAnimacao extends FabricaBase<RestricoesAnimacao> {
  constructor(prototipo: ProjetoAnimacao) { super(prototipo); }
  criarValidador(): ValidadorProjeto { return new ValidadorAnimacao(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorAnimacao(this.restricoes()); }
  override criarRelatorio(): VisitanteProjeto<string> { return new GeradorRelatorioAnimacao(this.restricoes()); }
}
export class FabricaPublicitario extends FabricaBase<RestricoesPublicitario> {
  constructor(prototipo: ProjetoPublicitario) { super(prototipo); }
  criarValidador(): ValidadorProjeto { return new ValidadorPublicitario(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorPublicitario(this.restricoes()); }
}
