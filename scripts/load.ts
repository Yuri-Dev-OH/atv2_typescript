import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { criarBanco, ProfissionalSchema, CompetenciaSchema, AvaliacaoSchema } from '../src/infrastructure/database.js';
import { RepositorioPostgres } from '../src/infrastructure/postgres-repository.js';
import { criarApp } from '../src/http/app.js';
import { id } from '../src/domain/model.js';
import { profissionaisExemplo, projetoExemplo } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
assert(url && new URL(url).pathname.endsWith('_test'), 'Configure TEST_DATABASE_URL com banco separado, terminado em _test.');
const banco = criarBanco(url);
await banco.initialize();
await banco.runMigrations();
// O teste usa exclusivamente o banco de teste. Nunca apaga o banco de desenvolvimento.
await banco.query('TRUNCATE integracao, notificacao, auditoria, evento, convite, recomendacao, projeto, avaliacao, competencia, profissional');
const exemplos = profissionaisExemplo();
for (let inicio = 0; inicio < 10000; inicio += 250) {
  const lote = Array.from({ length: Math.min(250, 10000 - inicio) }, (_, i) => ({ ...exemplos[(inicio + i) % exemplos.length]!, id: id(), nome: `Profissional ${inicio + i}`, email: `carga${inicio + i}@example.com` }));
  await banco.transaction(async m => {
    await m.insert(ProfissionalSchema, lote.map(({ competencias: _c, avaliacoes: _a, ...dados }) => ({ id: dados.id, dados })));
    await m.insert(CompetenciaSchema, lote.flatMap(p => p.competencias.map(c => ({ ...c, profissionalId: p.id }))));
    await m.insert(AvaliacaoSchema, lote.flatMap(p => p.avaliacoes.map(a => ({ ...a, profissionalId: p.id }))));
  });
}
const { app, sistema, eventos } = criarApp(new RepositorioPostgres(banco), { processarEventos: false });
const erros = new Map<string, number>();
app.addHook('onError', async (_request, _reply, erro) => {
  const mensagem = erro.message;
  erros.set(mensagem, (erros.get(mensagem) ?? 0) + 1);
});
try {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const endereco = app.server.address(); assert(endereco && typeof endereco !== 'string');
  const endpoint = `http://127.0.0.1:${endereco.port}/projetos`;
  await sistema.catalogo.obter();
  // Medição HTTP real: 100 solicitações iniciadas simultaneamente, misturando estratégias.
  const resultados = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    const inicio = performance.now();
    const p = { ...projetoExemplo(), titulo: `Carga ${i}`, orcamento: 7200 + i * 10, estrategia: (['cosseno', 'colaborativa', 'orcamento'] as const)[i % 3] };
    const resposta = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    const dados = await resposta.json() as { equipe?: { membros: unknown[]; custo: number }; erro?: string };
    return { ms: performance.now() - inicio, status: resposta.status, erro: dados.erro, ok: resposta.status === 201 && dados.equipe?.membros.length === 6 && dados.equipe.custo <= p.orcamento };
  }));
  const tempos = resultados.map(r => r.ms).sort((a, b) => a - b);
  const relatorio = { profissionais: 10000, concorrencia: 100, sucessos: resultados.filter(r => r.ok).length, medianaMs: tempos[50], p95Ms: tempos[94], maxMs: tempos[99] };
  console.log(JSON.stringify(relatorio, null, 2));
  if (resultados.some(r => !r.ok)) {
    console.log('Falhas:', resultados.filter(r => !r.ok).slice(0, 5));
    console.log('Causas:', Object.fromEntries(erros));
  }
  assert(resultados.every(r => r.ok), 'Houve respostas inválidas.');
  assert(tempos[99]! < 2000, 'O limite de dois segundos não foi atendido neste ambiente.');
} finally { await eventos.processar(); await app.close(); await banco.destroy(); }
