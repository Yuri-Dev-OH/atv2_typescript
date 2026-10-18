import { randomUUID } from 'node:crypto';

export const PAPEIS = ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA', 'EDITOR', 'ROTEIRISTA', 'EFEITOS_VISUAIS'] as const;
export type Papel = typeof PAPEIS[number];
export type Estrategia = 'cosseno' | 'colaborativa' | 'orcamento';
export interface Competencia { nome: string; nivel: number }
export interface Avaliacao { produtorId: string; nota: number; comentario: string; data: string }
export interface Trabalho { projetoId: string; genero: string; papel: Papel }
export interface ProfissionalDados {
  id: string;
  nome: string;
  email: string;
  papeis: Papel[];
  competencias: Competencia[];
  preco: number;
  faixaPreco: { minimo: number; maximo: number };
  disponibilidade: { inicio: string; fim: string };
  localizacao: string;
  remoto: boolean;
  historico: Trabalho[];
  avaliacoes: Avaliacao[];
}
export interface PapelExigido { papel: Papel; peso: number; competencias: Competencia[] }
export interface Parametros { pesoTecnico: number; pesoHistorico: number; notaMinima: number }
export interface ProjetoDados {
  id: string;
  produtorId: string;
  emailProdutor: string;
  titulo: string;
  genero: string;
  duracao: number;
  orcamento: number;
  inicio: string;
  prazo: string;
  tipoCaptacao: 'documentario' | 'ficcao' | 'animacao';
  localizacao: string;
  papeis: PapelExigido[];
  estrategia: Estrategia;
  parametros: Parametros;
}
export interface Candidato { profissionalId: string; nome: string; preco: number; pontuacao: number }
export interface MembroEquipe extends Candidato { papel: Papel; confirmado: boolean; aceitoProdutor: boolean }
export interface Equipe {
  id: string;
  membros: MembroEquipe[];
  status: 'sugerida' | 'aguardando' | 'formada' | 'parcial';
  custo: number;
  dataFormacao?: string;
}
export interface Recomendacao {
  id: string;
  criadaEm: string;
  estrategia: Estrategia;
  ranking: Partial<Record<Papel, Candidato[]>>;
  faltantes: Papel[];
  avisos: string[];
  degradada: boolean;
}
export interface Convite {
  id: string;
  papel: Papel;
  profissionalId: string;
  status: 'pendente' | 'aceito' | 'recusado' | 'cancelado';
  respostaProcessada?: boolean;
}
export interface EstadoProjeto {
  projeto: ProjetoDados;
  equipe: Equipe;
  recomendacao: Recomendacao;
  convites: Convite[];
  excluidos: Partial<Record<Papel, string[]>>;
  versao: number;
}
export interface Destinatario { id: string; email: string }
export interface EventoRecomendacao {
  id: string;
  tipo: string;
  projetoId: string;
  origem: string;
  data: string;
  dados: Record<string, unknown>;
  destinatarios: Destinatario[];
  entregues: string[];
}
export interface Notificacao {
  id: string;
  eventoId: string;
  destinatarioId: string;
  canal: 'email' | 'interno';
  destino: string;
  mensagem: string;
  status: 'registrada' | 'enviada';
}
export interface VisitanteProjeto<T> {
  visitarProjeto(projeto: Projeto): T;
  visitarProfissional(profissional: Profissional): T;
}
export class Projeto {
  constructor(readonly estado: EstadoProjeto, readonly profissionais: Profissional[] = []) {}
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProjeto(this); }
}
export class Profissional {
  constructor(readonly dados: ProfissionalDados) {}
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProfissional(this); }
}
export class ErroDominio extends Error {
  constructor(message: string, readonly statusCode = 422) { super(message); }
}
export const id = () => randomUUID();
export const centavos = (valor: number) => Math.round(valor * 100);
export const agora = () => new Date().toISOString();
export function exigir(condicao: unknown, mensagem: string, status = 422): asserts condicao {
  if (!condicao) throw new ErroDominio(mensagem, status);
}
export function validarProjeto(p: ProjetoDados): void {
  validarData(p.inicio);
  validarData(p.prazo);
  exigir(p.inicio <= p.prazo, 'O início deve ser anterior ou igual ao prazo.');
  exigir(p.papeis.length > 0 && new Set(p.papeis.map(x => x.papel)).size === p.papeis.length, 'Os papéis devem ser únicos e não vazios.');
  exigir(p.parametros.pesoTecnico + p.parametros.pesoHistorico > 0, 'Informe ao menos um peso maior que zero.');
  for (const papel of p.papeis) validarCompetencias(papel.competencias);
}
export function validarCompetencias(lista: Competencia[]): void {
  exigir(new Set(lista.map(c => c.nome.trim().toLowerCase())).size === lista.length, 'Competências duplicadas.');
}
export function validarProfissional(p: ProfissionalDados): void {
  exigir(p.faixaPreco.minimo <= p.faixaPreco.maximo, 'Faixa de preço inválida.');
  exigir(p.preco >= p.faixaPreco.minimo && p.preco <= p.faixaPreco.maximo, 'O preço deve pertencer à faixa informada.');
  validarData(p.disponibilidade.inicio);
  validarData(p.disponibilidade.fim);
  for (const avaliacao of p.avaliacoes) validarData(avaliacao.data);
  exigir(p.disponibilidade.inicio <= p.disponibilidade.fim, 'Disponibilidade inválida.');
  validarCompetencias(p.competencias);
  exigir(new Set(p.avaliacoes.map(a => a.produtorId)).size === p.avaliacoes.length, 'Informe uma avaliação por produtor.');
}
export function validarData(valor: string): void {
  const data = new Date(`${valor}T00:00:00.000Z`);
  exigir(!Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor, `Data inválida: ${valor}.`);
}
