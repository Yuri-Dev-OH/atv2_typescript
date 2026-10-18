import assert from 'node:assert/strict';
import { criarBanco } from '../src/infrastructure/database.js';
import { RepositorioPostgres } from '../src/infrastructure/postgres-repository.js';
import { CatalogoHttp, PublicadorHttp } from '../src/infrastructure/http-clients.js';
import { criarConsumidor } from '../src/infrastructure/integration-consumer.js';
import { criarApp } from '../src/http/app.js';
import { profissionaisExemplo, projetoExemplo } from './fixtures.js';

const banco = criarBanco(process.env.DATABASE_URL ?? '');
await banco.initialize();
const projetos = criarConsumidor('gerenciamento-projetos'), financeiro = criarConsumidor('processamento-financeiro');
const destinos = {
  'gerenciamento-projetos': `${await projetos.app.listen({ port: 0, host: '127.0.0.1' })}/eventos`,
  'processamento-financeiro': `${await financeiro.app.listen({ port: 0, host: '127.0.0.1' })}/eventos`,
};
const contexto = criarApp(new RepositorioPostgres(banco), { processarEventos: false, integracao: new PublicadorHttp(destinos),
  profissionais: process.env.CATALOGO_URL ? new CatalogoHttp(process.env.CATALOGO_URL) : undefined });
try {
  const existentes = new Set((await contexto.sistema.catalogo.obter()).profissionais.map(p => p.email));
  for (const p of profissionaisExemplo()) if (!existentes.has(p.email)) await contexto.sistema.cadastrarProfissional(p);
  let estado = await contexto.sistema.criar(projetoExemplo());
  for (const m of estado.equipe.membros) {
    estado = await contexto.sistema.decidir(estado.projeto.id, m.papel, 'aceitar');
    const convite = estado.convites.find(c => c.papel === m.papel && c.status === 'pendente')!;
    estado = await contexto.sistema.responderConvite(estado.projeto.id, convite.id, true);
  }
  await contexto.eventos.processar();
  assert.equal(estado.equipe.status, 'formada');
  assert.equal(projetos.projetos.get(estado.projeto.id)?.status, 'em_producao');
  assert.equal(financeiro.projetos.get(estado.projeto.id)?.status, 'aguardando_pagamento');
  console.log(JSON.stringify({ projetoId: estado.projeto.id, projetos: projetos.projetos.get(estado.projeto.id), financeiro: financeiro.projetos.get(estado.projeto.id) }, null, 2));
} finally { await contexto.app.close(); await projetos.app.close(); await financeiro.app.close(); await banco.destroy(); }
