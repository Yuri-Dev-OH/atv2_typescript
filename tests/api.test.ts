import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/http/app.js';
import { id, type EstadoProjeto, type Papel } from '../src/domain/model.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

describe('API e casos de uso', () => {
  let repo: RepositorioMemoria;
  let contexto: ReturnType<typeof criarApp>;
  beforeEach(async () => {
    repo = new RepositorioMemoria(); contexto = criarApp(repo, { processarEventos: false });
    for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
  });
  afterEach(async () => { await contexto.app.close(); });
  async function criar(): Promise<EstadoProjeto> {
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: projetoExemplo() });
    expect(r.statusCode, r.body).toBe(201); return r.json();
  }
  it('forma equipe consensual, publica integrações, audita e gera relatório', async () => {
    let estado = await criar();
    const pid = estado.projeto.id;
    for (const membro of estado.equipe.membros) {
      const aceite = await contexto.app.inject({ method: 'POST', url: `/projetos/${pid}/membros/${membro.papel}`, payload: { acao: 'aceitar' } });
      expect(aceite.statusCode).toBe(200); estado = aceite.json();
      const convite = estado.convites.find(c => c.papel === membro.papel && c.status === 'pendente')!;
      const resposta = await contexto.app.inject({ method: 'POST', url: `/projetos/${pid}/convites/${convite.id}/responder`, payload: { aceitar: true } });
      expect(resposta.statusCode).toBe(200); estado = resposta.json();
    }
    expect(estado.equipe.status).toBe('formada');
    expect(estado.equipe.dataFormacao).toBeDefined();
    await contexto.eventos.processar();
    const relatorio = await contexto.app.inject(`/projetos/${pid}/relatorio`);
    expect(relatorio.json().pendencias).toEqual([]);
    expect((await contexto.app.inject('/integracoes')).json()).toHaveLength(2);
    expect((await contexto.app.inject(`/auditoria?projetoId=${pid}`)).json().some((e: { tipo: string }) => e.tipo === 'EQUIPE_FORMADA')).toBe(true);
    expect((await contexto.app.inject('/notificacoes?destinatarioId=produtor-demo')).json().length).toBeGreaterThan(0);
    expect((await contexto.app.inject(`/projetos/${pid}`)).json().versao).toBe(19);
    expect((await contexto.app.inject('/eventos')).json().length).toBeGreaterThan(0);
  });
  it('recusa dispara nova recomendação e mantém as demais escolhas', async () => {
    const original = await criar(), pid = original.projeto.id;
    const aceito = await contexto.sistema.decidir(pid, 'EDITOR', 'aceitar');
    const convite = aceito.convites[0]!;
    const novo = await contexto.sistema.responderConvite(pid, convite.id, false);
    expect(novo.equipe.membros.find(m => m.papel === 'EDITOR')!.profissionalId).not.toBe(convite.profissionalId);
    expect(novo.equipe.membros.filter(m => m.papel !== 'EDITOR')).toEqual(original.equipe.membros.filter(m => m.papel !== 'EDITOR'));
    await expect(contexto.sistema.responderConvite(pid, convite.id, true)).rejects.toMatchObject({ statusCode: 409 });
    await expect(contexto.sistema.responderConvite(pid, id(), true)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('notifica o produtor e todos os profissionais apresentados nas recomendações', async () => {
    const estado = await criar();
    const evento = (await repo.eventos()).find(e => e.projetoId === estado.projeto.id && e.tipo === 'RECOMENDACAO_GERADA')!;
    const ids = new Set(evento.destinatarios.map(d => d.id));
    expect(ids.has(estado.projeto.produtorId)).toBe(true);
    for (const candidato of Object.values(estado.recomendacao.ranking).flat()) expect(ids.has(candidato.profissionalId)).toBe(true);
    expect(ids.size).toBe(19);
  });
  it('substitui manualmente, cancela convite e preserva membros fixos', async () => {
    const estado = await criar(), pid = estado.projeto.id;
    const anterior = await contexto.sistema.decidir(pid, 'EDITOR', 'aceitar');
    const candidato = [...repo.profissionais.values()].find(p => p.papeis.includes('EDITOR') && p.preco === 600)!;
    const r = await contexto.app.inject({ method: 'POST', url: `/projetos/${pid}/membros/EDITOR`, payload: { acao: 'substituir', profissionalId: candidato.id } });
    expect(r.statusCode, r.body).toBe(200);
    const novo: EstadoProjeto = r.json();
    expect(novo.equipe.membros.find(m => m.papel === 'EDITOR')!.profissionalId).toBe(candidato.id);
    expect(novo.convites[0]!.status).toBe('cancelado');
    expect(novo.equipe.membros.filter(m => m.papel !== 'EDITOR')).toEqual(anterior.equipe.membros.filter(m => m.papel !== 'EDITOR'));
  });
  it('reavalia orçamento, cronograma e estratégia, cancelando convites antigos', async () => {
    const estado = await criar(), pid = estado.projeto.id;
    await contexto.sistema.decidir(pid, 'DIRETOR', 'aceitar');
    const r = await contexto.app.inject({ method: 'POST', url: `/projetos/${pid}/reavaliar`, payload: { orcamento: 2400, estrategia: 'orcamento', inicio: '2028-01-01', prazo: '2028-02-01' } });
    expect(r.statusCode, r.body).toBe(200);
    const novo: EstadoProjeto = r.json();
    expect(novo.equipe.custo).toBe(2400);
    expect(novo.convites[0]!.status).toBe('cancelado');
    expect(novo.equipe.membros.every(m => !m.aceitoProdutor)).toBe(true);
  });
  it('rejeita candidatos até retornar equipe parcial e permite substituir papel vazio', async () => {
    const estado = await criar(), pid = estado.projeto.id;
    for (let i = 0; i < 3; i++) await contexto.sistema.decidir(pid, 'DIRETOR', 'rejeitar');
    expect((await contexto.sistema.obter(pid)).equipe.status).toBe('parcial');
    await expect(contexto.sistema.decidir(pid, 'DIRETOR', 'aceitar')).rejects.toThrow('Não há');
    await expect(contexto.sistema.decidir(pid, 'DIRETOR', 'rejeitar')).rejects.toThrow('Não há');
    expect((await contexto.sistema.decidir(pid, 'DIRETOR', 'substituir')).recomendacao.faltantes).toContain('DIRETOR');
  });
  it('valida erros de substituição e de aceite sem gravar alterações parciais', async () => {
    const estado = await criar(), pid = estado.projeto.id;
    const m = estado.equipe.membros[0]!;
    await expect(contexto.sistema.decidir(pid, m.papel, 'substituir', m.profissionalId)).rejects.toThrow('rejeitado');
    await expect(contexto.sistema.decidir(pid, m.papel, 'substituir', id())).rejects.toMatchObject({ statusCode: 404 });
    const outro = estado.equipe.membros.find(x => x.papel !== m.papel)!;
    await expect(contexto.sistema.decidir(pid, m.papel, 'substituir', outro.profissionalId)).rejects.toThrow('substituto');
    expect((await contexto.sistema.obter(pid)).versao).toBe(1);
    await contexto.sistema.decidir(pid, m.papel, 'aceitar');
    await expect(contexto.sistema.decidir(pid, m.papel, 'aceitar')).rejects.toMatchObject({ statusCode: 409 });
    await expect(contexto.sistema.decidir(pid, 'INVALIDO' as Papel, 'aceitar')).rejects.toThrow('Papel');
    const erro = await contexto.app.inject({ method: 'POST', url: `/projetos/${pid}/membros/${m.papel}`, payload: { acao: 'aceitar', profissionalId: m.profissionalId } });
    expect(erro.statusCode).toBe(422);
  });
  it('usa fallback quando o catálogo falha e não confirma substituição sem validação', async () => {
    const estado = await criar();
    contexto.sistema.catalogo.invalidar();
    vi.spyOn(repo, 'listarProfissionais').mockRejectedValue(new Error('offline'));
    const degradado = await contexto.sistema.reavaliar(estado.projeto.id, { orcamento: 9000 });
    expect(degradado.recomendacao.degradada).toBe(true);
    expect(degradado.equipe.status).toBe('sugerida');
    expect(degradado.equipe.membros).toHaveLength(6);
    await expect(contexto.sistema.decidir(estado.projeto.id, 'DIRETOR', 'substituir', id())).rejects.toMatchObject({ statusCode: 503 });
  });
  it('recusa gravações concorrentes e mantém uma única decisão', async () => {
    const estado = await criar();
    const respostas = await Promise.allSettled([contexto.sistema.decidir(estado.projeto.id, 'DIRETOR', 'aceitar'), contexto.sistema.decidir(estado.projeto.id, 'DIRETOR', 'aceitar')]);
    expect(respostas.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await contexto.sistema.obter(estado.projeto.id)).convites).toHaveLength(1);
  });
  it('cadastra e lista profissionais; expõe saúde e erros de infraestrutura', async () => {
    const r = await contexto.app.inject({ method: 'POST', url: '/profissionais', payload: profissionaisExemplo()[0] });
    expect(r.statusCode).toBe(201);
    expect((await contexto.app.inject('/profissionais')).json()).toHaveLength(19);
    expect((await contexto.app.inject('/saude')).statusCode).toBe(200);
    vi.spyOn(repo, 'saudavel').mockResolvedValue(false);
    expect((await contexto.app.inject('/saude')).statusCode).toBe(503);
    vi.spyOn(repo, 'obterProjeto').mockRejectedValue(new Error('offline'));
    expect((await contexto.app.inject(`/projetos/${id()}`)).statusCode).toBe(503);
  });
  it.each([
    { orcamento: -1 }, { prazo: '2027-02-30' }, { inicio: '2029-01-01' }, { estrategia: 'invalida' },
    { parametros: { pesoTecnico: 0, pesoHistorico: 0 } }, { desconhecido: 1 }, { papeis: [] },
  ])('rejeita entrada inválida: %j', async mudanca => {
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), ...mudanca } });
    expect([400, 422]).toContain(r.statusCode);
    expect(repo.projetos.size).toBe(0);
  });
  it('aplica padrões de parâmetros, retorna 404 e rejeita JSON inválido', async () => {
    const { estrategia: _e, parametros: _p, ...dados } = projetoExemplo();
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: dados });
    expect(r.statusCode).toBe(201);
    expect(r.json().projeto.parametros.pesoTecnico).toBe(0.7);
    expect((await contexto.app.inject(`/projetos/${id()}`)).statusCode).toBe(404);
    expect((await contexto.app.inject('/projetos/invalido')).statusCode).toBe(400);
    expect((await contexto.app.inject({ method: 'POST', url: '/projetos', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode).toBe(400);
  });
});
