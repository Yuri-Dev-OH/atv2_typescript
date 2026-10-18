import { criarBanco } from '../src/infrastructure/database.js';
import { RepositorioPostgres } from '../src/infrastructure/postgres-repository.js';
import { criarApp } from '../src/http/app.js';
import { profissionaisExemplo } from './fixtures.js';
import { CatalogoHttp } from '../src/infrastructure/http-clients.js';

const banco = criarBanco(process.env.DATABASE_URL ?? '');
await banco.initialize();
const repo = new RepositorioPostgres(banco);
const profissionais = process.env.CATALOGO_URL ? new CatalogoHttp(process.env.CATALOGO_URL) : repo;
const { app, sistema, eventos } = criarApp(repo, { processarEventos: false, profissionais });
try {
  const existentes = new Set((await profissionais.listarProfissionais()).map(p => p.email));
  let criados = 0;
  for (const p of profissionaisExemplo()) if (!existentes.has(p.email)) { await sistema.cadastrarProfissional(p); criados++; }
  await eventos.processar();
  console.log(`${criados} profissionais cadastrados.`);
} finally { await app.close(); await banco.destroy(); }
