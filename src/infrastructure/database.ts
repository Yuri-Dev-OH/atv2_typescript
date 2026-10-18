import 'reflect-metadata';
import { DataSource, EntitySchema, type MigrationInterface, type QueryRunner } from 'typeorm';
import type { Avaliacao, Competencia, EstadoProjeto, EventoRecomendacao, Notificacao, ProfissionalDados } from '../domain/model.js';

export interface ProfissionalRow { id: string; dados: Omit<ProfissionalDados, 'competencias' | 'avaliacoes'> }
export interface CompetenciaRow { profissionalId: string; nome: string; nivel: number }
export interface AvaliacaoRow extends Avaliacao { profissionalId: string }
export interface ProjetoRow { id: string; versao: number; estado: EstadoProjeto }
export interface EventoRow { id: string; dados: EventoRecomendacao; entregues: string[] }
export interface NotificacaoRow { id: string; destinatarioId: string; dados: Notificacao }
export interface AuditoriaRow { id: string; projetoId: string; dados: EventoRecomendacao }
export interface IntegracaoRow { id: string; eventoId: string; destino: string; dados: Record<string, unknown> }
export const ProfissionalSchema = new EntitySchema<ProfissionalRow>({ name: 'Profissional', tableName: 'profissional', columns: { id: { type: 'uuid', primary: true }, dados: { type: 'jsonb' } } });
export const CompetenciaSchema = new EntitySchema<CompetenciaRow>({ name: 'Competencia', tableName: 'competencia', columns: {
  profissionalId: { name: 'profissional_id', type: 'uuid', primary: true }, nome: { type: 'text', primary: true }, nivel: { type: 'double precision' },
} });
export const AvaliacaoSchema = new EntitySchema<AvaliacaoRow>({ name: 'Avaliacao', tableName: 'avaliacao', columns: {
  profissionalId: { name: 'profissional_id', type: 'uuid', primary: true }, produtorId: { name: 'produtor_id', type: 'text', primary: true },
  nota: { type: 'double precision' }, comentario: { type: 'text' }, data: { type: 'text' },
} });
export const ProjetoSchema = new EntitySchema<ProjetoRow>({ name: 'Projeto', tableName: 'projeto', columns: {
  id: { type: 'uuid', primary: true }, versao: { type: 'integer' }, estado: { type: 'jsonb' },
} });
export const EventoSchema = new EntitySchema<EventoRow>({ name: 'Evento', tableName: 'evento', columns: {
  id: { type: 'uuid', primary: true }, dados: { type: 'jsonb' }, entregues: { type: 'text', array: true },
} });
export const NotificacaoSchema = new EntitySchema<NotificacaoRow>({ name: 'Notificacao', tableName: 'notificacao', columns: {
  id: { type: 'text', primary: true }, destinatarioId: { name: 'destinatario_id', type: 'text' }, dados: { type: 'jsonb' },
} });
export const AuditoriaSchema = new EntitySchema<AuditoriaRow>({ name: 'Auditoria', tableName: 'auditoria', columns: {
  id: { type: 'uuid', primary: true }, projetoId: { name: 'projeto_id', type: 'text' }, dados: { type: 'jsonb' },
} });
export const IntegracaoSchema = new EntitySchema<IntegracaoRow>({ name: 'Integracao', tableName: 'integracao', columns: {
  id: { type: 'text', primary: true }, eventoId: { name: 'evento_id', type: 'uuid' }, destino: { type: 'text' }, dados: { type: 'jsonb' },
} });
export class Inicial1780000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE profissional (id uuid PRIMARY KEY, dados jsonb NOT NULL);
      CREATE TABLE competencia (profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE, nome text NOT NULL, nivel double precision NOT NULL CHECK(nivel BETWEEN 0 AND 1), PRIMARY KEY(profissional_id, nome));
      CREATE TABLE avaliacao (profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE, produtor_id text NOT NULL, nota double precision NOT NULL CHECK(nota BETWEEN 1 AND 5), comentario text NOT NULL, data text NOT NULL, PRIMARY KEY(profissional_id, produtor_id));
      CREATE TABLE projeto (id uuid PRIMARY KEY, versao integer NOT NULL, estado jsonb NOT NULL);
      CREATE TABLE recomendacao (id uuid PRIMARY KEY, projeto_id uuid NOT NULL REFERENCES projeto(id), dados jsonb NOT NULL);
      CREATE TABLE convite (id uuid PRIMARY KEY, projeto_id uuid NOT NULL REFERENCES projeto(id), profissional_id uuid NOT NULL REFERENCES profissional(id), papel text NOT NULL, status text NOT NULL CHECK(status IN ('pendente','aceito','recusado','cancelado')));
      CREATE TABLE evento (id uuid PRIMARY KEY, dados jsonb NOT NULL, entregues text[] NOT NULL DEFAULT '{}');
      CREATE TABLE auditoria (id uuid PRIMARY KEY REFERENCES evento(id), projeto_id text NOT NULL, dados jsonb NOT NULL);
      CREATE TABLE notificacao (id text PRIMARY KEY, destinatario_id text NOT NULL, dados jsonb NOT NULL);
      CREATE TABLE integracao (id text PRIMARY KEY, evento_id uuid NOT NULL REFERENCES evento(id), destino text NOT NULL, dados jsonb NOT NULL);
      CREATE INDEX convite_projeto ON convite(projeto_id);
      CREATE INDEX recomendacao_projeto ON recomendacao(projeto_id);
      CREATE INDEX auditoria_projeto ON auditoria(projeto_id);
      CREATE INDEX notificacao_destinatario ON notificacao(destinatario_id);
      CREATE INDEX evento_pendente ON evento(id) WHERE cardinality(entregues) < 4;
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE integracao, notificacao, auditoria, evento, convite, recomendacao, projeto, avaliacao, competencia, profissional');
  }
}
export function criarBanco(url: string): DataSource {
  return new DataSource({ type: 'postgres', url,
    entities: [ProfissionalSchema, CompetenciaSchema, AvaliacaoSchema, ProjetoSchema, EventoSchema, NotificacaoSchema, AuditoriaSchema, IntegracaoSchema],
    migrations: [Inicial1780000000000, CatalogoIndependente1790000000000], synchronize: false, logging: false,
    // Cem solicitações compartilham vinte conexões; a espera não pode expirar em 1 s.
    extra: { max: 20, connectionTimeoutMillis: 2000, statement_timeout: 1500 },
  });
}
export class CatalogoIndependente1790000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // O identificador continua válido mesmo quando o catálogo está em outro banco.
    await q.query('ALTER TABLE convite DROP CONSTRAINT convite_profissional_id_fkey');
    await q.query(`UPDATE profissional SET dados=jsonb_set(dados, '{faixaPreco}', jsonb_build_object('minimo', dados->'preco', 'maximo', dados->'preco')) WHERE NOT dados ? 'faixaPreco'`);
    await q.query('DROP INDEX evento_pendente');
    // Antes desta migração, as respostas já eram aplicadas sincronamente pelo serviço.
    await q.query("UPDATE evento SET entregues=array_append(entregues, 'composicao') WHERE NOT ('composicao'=ANY(entregues))");
  }
  async down(q: QueryRunner): Promise<void> {
    // NOT VALID preserva os convites de profissionais que pertencem ao catálogo externo.
    await q.query('ALTER TABLE convite ADD CONSTRAINT convite_profissional_id_fkey FOREIGN KEY(profissional_id) REFERENCES profissional(id) NOT VALID');
    await q.query('CREATE INDEX evento_pendente ON evento(id) WHERE cardinality(entregues) < 4');
  }
}
