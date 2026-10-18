import { describe, expect, it, vi } from 'vitest';
import { CatalogoProfissionais } from '../src/application/catalog.js';
import { id, type EventoRecomendacao } from '../src/domain/model.js';
import { AuditoriaRecomendacao, EventosEmMemoria, IntegracaoEquipe, NotificadorEmail, NotificadorInterno } from '../src/events/observers.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { profissionaisExemplo } from '../scripts/fixtures.js';

const logger = { info: vi.fn(), error: vi.fn() };
function evento(): EventoRecomendacao { return { id: id(), projetoId: id(), tipo: 'EQUIPE_FORMADA', origem: 'teste', data: new Date().toISOString(), dados: { equipe: [] }, destinatarios: [{ id: 'produtor', email: 'p@example.com' }], entregues: [] }; }
describe('Observer', () => {
  it('aguarda também os eventos gravados durante uma entrega em andamento', async () => {
    const repo = new RepositorioMemoria(), bus = new EventosEmMemoria(repo, logger);
    const primeiro = evento(), segundo = evento();
    const iniciou = Promise.withResolvers<void>(), liberar = Promise.withResolvers<void>();
    const recebidos: string[] = [];
    bus.adicionarObservador({ nome: 'auditoria', async atualizar(e) {
      if (e.id === primeiro.id) { iniciou.resolve(); await liberar.promise; }
      recebidos.push(e.id);
    } });
    repo.fila.set(primeiro.id, primeiro);
    const entrega = bus.processar();
    await iniciou.promise;
    repo.fila.set(segundo.id, segundo);
    const conclusao = bus.processar();
    liberar.resolve();
    await Promise.all([entrega, conclusao]);
    expect(recebidos).toEqual([primeiro.id, segundo.id]);
  });
  it('isola falhas, repete entregas pendentes e não duplica as já concluídas', async () => {
    const repo = new RepositorioMemoria(), bus = new EventosEmMemoria(repo, logger), e = evento();
    repo.fila.set(e.id, e);
    const enviar = vi.fn().mockRejectedValueOnce(new Error('SMTP indisponível')).mockResolvedValue(undefined);
    bus.adicionarObservador(new AuditoriaRecomendacao(repo, logger));
    bus.adicionarObservador(new NotificadorEmail(repo, { enviar }));
    bus.adicionarObservador(new NotificadorInterno(repo));
    bus.adicionarObservador(new IntegracaoEquipe(repo));
    await Promise.all([bus.processar(), bus.processar()]);
    expect((await repo.auditoria(e.projetoId))).toHaveLength(1);
    expect((await repo.notificacoes('produtor'))).toHaveLength(1);
    expect(await repo.integracoes()).toHaveLength(2);
    expect(e.entregues).not.toContain('email');
    await bus.processar(); await bus.processar();
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(e.entregues).toHaveLength(4);
    expect(await repo.notificacoes()).toHaveLength(2);
    await new NotificadorEmail(repo, { enviar }).atualizar(e);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(() => bus.adicionarObservador(new NotificadorInterno(repo))).toThrow('duplicado');
    await repo.confirmarEntrega(e.id, 'email');
    expect(e.entregues).toHaveLength(4);
  });
  it('registra email local, ignora integração para outros eventos e tolera fila indisponível', async () => {
    const repo = new RepositorioMemoria(), e = evento(); e.tipo = 'CONVITE_ENVIADO';
    await new NotificadorEmail(repo).atualizar(e);
    await new IntegracaoEquipe(repo).atualizar(e);
    expect((await repo.notificacoes())[0]!.status).toBe('registrada');
    expect(await repo.integracoes()).toEqual([]);
    expect(await repo.auditoria('inexistente')).toEqual([]);
    vi.spyOn(repo, 'eventos').mockRejectedValue(new Error('offline'));
    await expect(new EventosEmMemoria(repo, logger).processar()).resolves.toBeUndefined();
  });
});
describe('Catálogo e fallback', () => {
  it('compartilha consulta concorrente, invalida cache e não usa dados com mais de cinco minutos', async () => {
    const repo = new RepositorioMemoria(), prof = { ...profissionaisExemplo()[0]!, id: id() };
    repo.profissionais.set(prof.id, prof);
    const consulta = vi.spyOn(repo, 'listarProfissionais'), catalogo = new CatalogoProfissionais(repo, 0);
    const [a, b] = await Promise.all([catalogo.obter(), catalogo.obter()]);
    expect(a).toEqual(b); expect(consulta).toHaveBeenCalledTimes(1);
    consulta.mockRejectedValue(new Error('offline'));
    expect((await catalogo.obter()).profissionais).toHaveLength(1);
    const tempo = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 310000);
    expect(await catalogo.obter()).toEqual({ profissionais: [], degradada: true });
    tempo.mockRestore();
    catalogo.invalidar();
    expect((await catalogo.obter()).degradada).toBe(true);
  });
});
