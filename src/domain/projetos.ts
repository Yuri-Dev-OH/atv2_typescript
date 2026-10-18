import { FabricaAnimacao, FabricaDocumentario, FabricaFiccao, FabricaPublicitario } from './fabricas.js';
import { Projeto, type EstadoProjeto, type Profissional, type RestricoesProjeto } from './model.js';

export interface RestricoesDocumentario extends RestricoesProjeto {
  /** Exige termo de cessão de direito de imagem dos entrevistados. */
  exigeDireitoImagem: boolean;
  /** Captação em locações reais, sem estúdio. */
  locacoesReais: boolean;
  /** Janela mínima, em dias, entre início e entrega para a captação em campo. */
  diasMinimosCaptacao: number;
}
export interface RestricoesAnimacao extends RestricoesProjeto {
  /** Softwares de modelagem 3D aceitos no pipeline. */
  softwares3D: string[];
  /** Orçamento de render, em minutos de máquina por minuto de obra. */
  minutosRenderPorMinuto: number;
}
export interface RestricoesPublicitario extends RestricoesProjeto {
  /** Janela máxima, em dias, entre início e entrega. */
  prazoMaximoDias: number;
  /** Cada corte precisa de aprovação da agência ou do cliente. */
  aprovacaoCliente: boolean;
}

export const restricoesFiccao = (): RestricoesProjeto => ({
  papeisObrigatorios: ['DIRETOR'], competenciasPrioritarias: [{ nome: 'roteirista', nivel: 1 }],
});
export const restricoesDocumentario = (): RestricoesDocumentario => ({
  papeisObrigatorios: ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA', 'EDITOR'],
  competenciasPrioritarias: [{ nome: 'captacao em campo', nivel: 1 }], exigeDireitoImagem: true, locacoesReais: true, diasMinimosCaptacao: 14,
});
export const restricoesAnimacao = (): RestricoesAnimacao => ({
  papeisObrigatorios: ['DIRETOR', 'EFEITOS_VISUAIS', 'EDITOR'],
  competenciasPrioritarias: [{ nome: 'modelagem 3d', nivel: 1 }], softwares3D: ['Blender', 'Maya'], minutosRenderPorMinuto: 120,
});
export const restricoesPublicitario = (): RestricoesPublicitario => ({
  papeisObrigatorios: ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR'],
  competenciasPrioritarias: [{ nome: 'publicidade', nivel: 1 }], duracaoMaxima: 3, prazoMaximoDias: 30, aprovacaoCliente: true,
});

export class ProjetoFiccao extends Projeto {
  readonly tipo = 'ficcao';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesFiccao()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoFiccao { return new ProjetoFiccao(...this.copiarAgregados()); }
  override criarFabrica(): FabricaFiccao { return new FabricaFiccao(this); }
}
export class ProjetoDocumentario extends Projeto<RestricoesDocumentario> {
  readonly tipo = 'documentario';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesDocumentario()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoDocumentario { return new ProjetoDocumentario(...this.copiarAgregados()); }
  override criarFabrica(): FabricaDocumentario { return new FabricaDocumentario(this); }
}
export class ProjetoAnimacao extends Projeto<RestricoesAnimacao> {
  readonly tipo = 'animacao';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesAnimacao()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoAnimacao { return new ProjetoAnimacao(...this.copiarAgregados()); }
  override criarFabrica(): FabricaAnimacao { return new FabricaAnimacao(this); }
}
export class ProjetoPublicitario extends Projeto<RestricoesPublicitario> {
  readonly tipo = 'publicitario';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesPublicitario()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoPublicitario { return new ProjetoPublicitario(...this.copiarAgregados()); }
  override criarFabrica(): FabricaPublicitario { return new FabricaPublicitario(this); }
}
