import Fastify from 'fastify';
import { SistemaRecomendacao } from '../application/service.js';
import { ErroDominio, Profissional, exigir, type NovoProjeto, type Papel, type ProfissionalDados } from '../domain/model.js';
import type { PublicadorIntegracao, Repositorio, RepositorioProfissionais } from '../domain/ports.js';
import { CalculadorCompatibilidade, ValidadorConsistencia } from '../domain/visitors.js';
import { AuditoriaRecomendacao, EventosEmMemoria, IntegracaoEquipe, NotificadorEmail, NotificadorInterno, ObservadorComposicao, type EnviadorEmail } from '../events/observers.js';
import * as schemas from './schemas.js';
import { ControleConcorrencia } from './concurrency.js';

export function criarApp(repo: Repositorio, options: { logger?: boolean; email?: EnviadorEmail; processarEventos?: boolean; profissionais?: RepositorioProfissionais; integracao?: PublicadorIntegracao } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false, multipleOfPrecision: 2 } } });
  const eventos = new EventosEmMemoria(repo, app.log);
  eventos.adicionarObservador(new AuditoriaRecomendacao(repo, app.log));
  eventos.adicionarObservador(new NotificadorInterno(repo));
  eventos.adicionarObservador(new NotificadorEmail(repo, options.email));
  eventos.adicionarObservador(new IntegracaoEquipe(repo, options.integracao));
  const sistema = new SistemaRecomendacao(repo, eventos, undefined, options.profissionais);
  eventos.adicionarObservador(new ObservadorComposicao(evento => sistema.aplicarRespostaConvite(evento)));
  const gravacoes = new ControleConcorrencia();
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    if (options.processarEventos !== false) {
      timer = setInterval(() => { void eventos.processar(); }, 1000);
      timer.unref();
      void eventos.processar();
    }
  });
  app.addHook('onClose', async () => { clearInterval(timer); await eventos.processar(); });
  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof ErroDominio) return reply.code(erro.statusCode).send({ erro: erro.message });
    if (erro instanceof Error) {
      if ('validation' in erro && Array.isArray(erro.validation)) return reply.code(400).send({ erro: 'Dados inválidos.', detalhes: erro.validation });
      if ('statusCode' in erro && typeof erro.statusCode === 'number' && erro.statusCode >= 400 && erro.statusCode < 500) {
        return reply.code(erro.statusCode).send({ erro: erro.message });
      }
    }
    request.log.error({ err: erro }, 'Falha ao atender solicitação');
    return reply.code(503).send({ erro: 'Serviço indisponível. Tente novamente.' });
  });
  app.get('/saude', async (_req, reply) => {
    const banco = await repo.saudavel();
    return reply.code(banco ? 200 : 503).send({ status: banco ? 'ok' : 'indisponivel', banco });
  });
  app.post<{ Body: Omit<ProfissionalDados, 'id'> }>('/profissionais', { schema: { body: schemas.profissionalSchema } }, async (req, reply) => {
    return reply.code(201).send(await gravacoes.executar(() => sistema.cadastrarProfissional(req.body)));
  });
  app.get('/profissionais', async () => (options.profissionais ?? repo).listarProfissionais());
  app.post<{ Body: NovoProjeto }>('/projetos', { schema: { body: schemas.projetoSchema } }, async (req, reply) => {
    return reply.code(201).send(await gravacoes.executar(() => sistema.criar(req.body)));
  });
  app.get<{ Params: { id: string } }>('/projetos/:id', { schema: { params: schemas.projetoParams } }, async req => sistema.obter(req.params.id));
  app.post<{ Params: { id: string }; Body: Parameters<SistemaRecomendacao['reavaliar']>[1] }>('/projetos/:id/reavaliar', { schema: { params: schemas.projetoParams, body: schemas.reavaliacaoSchema } }, async req => gravacoes.executar(() => sistema.reavaliar(req.params.id, req.body)));
  app.post<{ Params: { id: string; papel: Papel }; Body: { acao: 'aceitar' | 'rejeitar' | 'substituir'; profissionalId?: string } }>('/projetos/:id/membros/:papel', { schema: { params: schemas.membroParams, body: schemas.decisaoSchema } }, async req => {
    exigir(!req.body.profissionalId || req.body.acao === 'substituir', 'profissionalId só deve ser informado em uma substituição.');
    return gravacoes.executar(() => sistema.decidir(req.params.id, req.params.papel, req.body.acao, req.body.profissionalId));
  });
  app.post<{ Params: { id: string; conviteId: string }; Body: { aceitar: boolean } }>('/projetos/:id/convites/:conviteId/responder', { schema: { params: schemas.conviteParams, body: schemas.respostaSchema } }, async req => gravacoes.executar(() => sistema.responderConvite(req.params.id, req.params.conviteId, req.body.aceitar)));
  app.get<{ Params: { id: string } }>('/projetos/:id/relatorio', { schema: { params: schemas.projetoParams } }, async req => {
    const estado = await sistema.obter(req.params.id);
    const catalogo = await sistema.catalogo.obter();
    const projeto = sistema.prototipos.hidratar(estado, catalogo.profissionais.filter(p => estado.equipe.membros.some(m => m.profissionalId === p.id)).map(p => new Profissional(p)));
    const fabrica = projeto.criarFabrica();
    return { tipo: projeto.tipo, restricoes: projeto.restricoes, texto: projeto.aceitar(fabrica.criarRelatorio()), compatibilidade: projeto.aceitar(new CalculadorCompatibilidade()), pendencias: [...projeto.aceitar(new ValidadorConsistencia()), ...fabrica.criarValidador().validar(estado.projeto)] };
  });
  app.get<{ Querystring: { destinatarioId?: string } }>('/notificacoes', { schema: { querystring: schemas.destinatarioQuery } }, async req => repo.notificacoes(req.query.destinatarioId));
  app.get<{ Querystring: { projetoId?: string } }>('/auditoria', { schema: { querystring: schemas.auditoriaQuery } }, async req => repo.auditoria(req.query.projetoId));
  app.get('/eventos', async () => repo.eventos());
  app.get('/integracoes', async () => repo.integracoes());
  return { app, sistema, eventos };
}
