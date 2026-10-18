import { criarBanco } from './infrastructure/database.js';
import { RepositorioPostgres } from './infrastructure/postgres-repository.js';
import { criarCatalogoApp } from './http/catalog-app.js';

const banco = criarBanco(process.env.DATABASE_URL ?? '');
await banco.initialize();
await banco.runMigrations();
const app = criarCatalogoApp(new RepositorioPostgres(banco));
app.addHook('onClose', async () => { await banco.destroy(); });
await app.listen({ port: Number(process.env.PORT ?? 3004), host: process.env.HOST ?? '127.0.0.1' });
process.on('SIGINT', () => { void app.close(); });
process.on('SIGTERM', () => { void app.close(); });
