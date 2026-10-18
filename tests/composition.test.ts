import { expect, it } from 'vitest';
import { SistemaRecomendacao } from '../src/application/service.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { ObservadorComposicao } from '../src/events/observers.js';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';
import { id } from '../src/domain/model.js';

it('a resposta só altera a equipe ao ser recebida pelo observador, com efeito idempotente', async () => {
  const repo = new RepositorioMemoria();
  const sistema = new SistemaRecomendacao(repo, { async processar() {} });
  await sistema.cadastrarProfissional(profissionaisExemplo()[0]!);
  let estado = await sistema.criar({ ...projetoExemplo(), papeis: projetoExemplo().papeis.slice(0, 1) });
  estado = await sistema.decidir(estado.projeto.id, 'DIRETOR', 'aceitar');
  const convite = estado.convites[0]!;
  estado = await sistema.responderConvite(estado.projeto.id, convite.id, true);
  expect(estado.equipe.status).toBe('aguardando');
  expect(estado.equipe.membros[0]!.confirmado).toBe(false);
  const evento = (await repo.eventos()).find(e => e.tipo === 'CONVITE_ACEITO')!;
  const observador = new ObservadorComposicao(e => sistema.aplicarRespostaConvite(e));
  await observador.atualizar(evento);
  const formado = await sistema.obter(estado.projeto.id);
  expect(formado.equipe.status).toBe('formada');
  await observador.atualizar(evento);
  expect((await sistema.obter(estado.projeto.id)).versao).toBe(formado.versao);
  expect((await repo.eventos()).filter(e => e.tipo === 'EQUIPE_FORMADA')).toHaveLength(1);
  await observador.atualizar({ ...evento, dados: { conviteId: id() } });
  await sistema.reavaliar(estado.projeto.id, { orcamento: 10000 });
  await observador.atualizar(evento);
  expect((await sistema.obter(estado.projeto.id)).equipe.status).toBe('sugerida');
});

it('rejeita faixas invertidas ou preço fora da faixa e aceita cadastro legado', async () => {
  const sistema = new SistemaRecomendacao(new RepositorioMemoria(), { async processar() {} });
  const p = profissionaisExemplo()[0]!;
  await expect(sistema.cadastrarProfissional({ ...p, faixaPreco: { minimo: 1500, maximo: 1000 } })).rejects.toThrow('Faixa');
  await expect(sistema.cadastrarProfissional({ ...p, preco: 900 })).rejects.toThrow('pertencer');
  const { faixaPreco: _f, ...legado } = p;
  const salvo = await sistema.cadastrarProfissional(legado as typeof p);
  expect(salvo.faixaPreco).toEqual({ minimo: p.preco, maximo: p.preco });
});
