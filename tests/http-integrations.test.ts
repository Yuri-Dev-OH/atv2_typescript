import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { criarCatalogoApp } from '../src/http/catalog-app.js';
import { criarApp } from '../src/http/app.js';
import { CatalogoHttp, PublicadorHttp } from '../src/infrastructure/http-clients.js';
import { criarConsumidor } from '../src/infrastructure/integration-consumer.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { IntegracaoEquipe } from '../src/events/observers.js';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';
import { id, agora, type EventoRecomendacao } from '../src/domain/model.js';

it('cadastra por HTTP e preserva a recomendação quando o catálogo independente cai', async () => {
  const catalogo = criarCatalogoApp(new RepositorioMemoria());
  const remoto = new CatalogoHttp(await catalogo.listen({ port: 0, host: '127.0.0.1' }));
  const repo = new RepositorioMemoria();
  const contexto = criarApp(repo, { profissionais: remoto, processarEventos: false });
  const frio = criarApp(repo, { profissionais: remoto, processarEventos: false });
  try {
    const p = await contexto.sistema.cadastrarProfissional(profissionaisExemplo()[0]!);
    await remoto.salvarProfissional(p);
    expect(await remoto.listarProfissionais()).toHaveLength(1);
    expect(await repo.listarProfissionais()).toHaveLength(0);
    expect((await catalogo.inject('/saude')).statusCode).toBe(200);
    expect((await contexto.app.inject('/profissionais')).json()).toHaveLength(1);
    await expect(remoto.salvarProfissional({ ...p, preco: 1 })).rejects.toThrow('422');
    const entrada = { ...projetoExemplo(), papeis: projetoExemplo().papeis.slice(0, 1) };
    expect((await contexto.sistema.criar(entrada)).equipe.status).toBe('sugerida');
    await catalogo.close();
    contexto.sistema.catalogo.invalidar();
    const quente = await contexto.sistema.criar(entrada);
    expect(quente.equipe.status).toBe('sugerida');
    const parcial = await frio.sistema.criar(entrada);
    expect(parcial.equipe.status).toBe('parcial');
    expect(await repo.obterProjeto(parcial.projeto.id)).toBeDefined();
    await expect(remoto.salvarProfissional(p)).rejects.toThrow();
  } finally { await contexto.app.close(); await frio.app.close(); await catalogo.close(); }
});

it('detecta resposta inválida e erro HTTP no catálogo', async () => {
  const app = Fastify();
  let falha = false;
  app.get('/profissionais', (_req, reply) => reply.code(falha ? 503 : 200).send({}));
  const remoto = new CatalogoHttp(await app.listen({ port: 0, host: '127.0.0.1' }));
  try {
    await expect(remoto.listarProfissionais()).rejects.toThrow('inválida');
    falha = true;
    await expect(remoto.listarProfissionais()).rejects.toThrow('503');
  } finally { await app.close(); }
});

it('entrega a dois consumidores HTTP e repete após falha sem duplicar efeitos', async () => {
  const projetos = criarConsumidor('gerenciamento-projetos');
  const financeiro = criarConsumidor('processamento-financeiro');
  const urlProjetos = await projetos.app.listen({ port: 0, host: '127.0.0.1' });
  const urlFinanceiro = await financeiro.app.listen({ port: 0, host: '127.0.0.1' });
  const destinos = { 'gerenciamento-projetos': `${urlProjetos}/eventos`, 'processamento-financeiro': `${urlFinanceiro}/ausente` };
  const publicador = new PublicadorHttp(destinos);
  const repo = new RepositorioMemoria();
  const observador = new IntegracaoEquipe(repo, publicador);
  const evento: EventoRecomendacao = { id: id(), tipo: 'EQUIPE_FORMADA', projetoId: id(), origem: 'teste', data: agora(), entregues: [], destinatarios: [],
    dados: { equipe: { id: id(), custo: 1200, membros: [{ profissionalId: id() }] } } };
  try {
    await expect(observador.atualizar(evento)).rejects.toThrow('404');
    expect(projetos.recebidos.size).toBe(1);
    destinos['processamento-financeiro'] = `${urlFinanceiro}/eventos`;
    await observador.atualizar(evento);
    await observador.atualizar(evento);
    expect(projetos.recebidos.size).toBe(1);
    expect(financeiro.recebidos.size).toBe(1);
    expect(financeiro.projetos.get(evento.projetoId)?.status).toBe('aguardando_pagamento');
    expect((await projetos.app.inject('/estado')).json().eventosProcessados).toBe(1);
    expect(await repo.integracoes()).toHaveLength(2);
    expect((await projetos.app.inject({ method: 'POST', url: '/eventos', payload: evento })).statusCode).toBe(400);
    await expect(publicador.publicar('ausente', evento)).rejects.toThrow('não configurado');
  } finally { await projetos.app.close(); await financeiro.app.close(); }
});
