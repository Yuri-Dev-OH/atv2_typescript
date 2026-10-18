import { agora, centavos, exigir, id, validarProfissional, validarProjeto, type Convite, type Destinatario, type EstadoProjeto, type EventoRecomendacao, type MembroEquipe, type NovoProjeto, type Papel, type ProfissionalDados, type ProjetoDados, type TipoProjeto } from '../domain/model.js';
import type { FabricaProjeto } from '../domain/fabricas.js';
import { RegistroPrototipos } from '../domain/prototipos.js';
import type { ProcessadorEventos, Repositorio, RepositorioProfissionais } from '../domain/ports.js';
import { OrquestradorPadrao, type OrquestradorEquipe } from '../recommendation/orchestrator.js';
import { CatalogoProfissionais } from './catalog.js';

export class SistemaRecomendacao {
  readonly catalogo: CatalogoProfissionais;
  /**
   * @param criarOrquestrador Monta o orquestrador com a fábrica do tipo de cada solicitação.
   * @param prototipos Protótipos de projeto; cada um fornece sua fábrica (Factory Method).
   */
  constructor(private readonly repo: Repositorio, private readonly eventos: ProcessadorEventos,
    private readonly criarOrquestrador: (fabrica: FabricaProjeto) => OrquestradorEquipe = fabrica => new OrquestradorPadrao(fabrica),
    private readonly profissionais: RepositorioProfissionais = repo, readonly prototipos: RegistroPrototipos = RegistroPrototipos.padrao()) {
    this.catalogo = new CatalogoProfissionais(profissionais);
  }
  /**
   * Seleciona a fábrica do tipo de projeto, sem condicionais: o protótipo registrado
   * para o tipo cria a fábrica concreta da sua família.
   *
   * @throws ErroDominio Quando o tipo não tem protótipo registrado.
   */
  fabricaPara(tipo: TipoProjeto): FabricaProjeto {
    return this.prototipos.obter(tipo).criarFabrica();
  }
  private orquestradorPara(projeto: ProjetoDados): OrquestradorEquipe {
    return this.criarOrquestrador(this.fabricaPara(projeto.tipoCaptacao));
  }
  private evento(tipo: string, projetoId: string, origem: string, dados: Record<string, unknown>, destinatarios: Destinatario[] = []): EventoRecomendacao {
    return { id: id(), tipo, projetoId, origem, dados, destinatarios: [...new Map(destinatarios.map(d => [d.id, d])).values()], data: agora(), entregues: [] };
  }
  async cadastrarProfissional(dados: Omit<ProfissionalDados, 'id'>): Promise<ProfissionalDados> {
    const profissional = { ...dados, faixaPreco: dados.faixaPreco ?? { minimo: dados.preco, maximo: dados.preco }, id: id() };
    validarProfissional(profissional);
    const evento = this.evento('PROFISSIONAL_CADASTRADO', '', profissional.id, { profissionalId: profissional.id });
    await this.profissionais.salvarProfissional(profissional, evento);
    if (this.profissionais !== this.repo) await this.repo.salvarEventos([evento]);
    this.catalogo.invalidar();
    void this.eventos.processar();
    return profissional;
  }
  async obter(projetoId: string): Promise<EstadoProjeto> {
    const estado = await this.repo.obterProjeto(projetoId);
    exigir(estado, 'Projeto não encontrado.', 404);
    return estado;
  }
  async criar(dados: NovoProjeto): Promise<EstadoProjeto> {
    // O protótipo do tipo fornece papéis, estratégia e parâmetros não informados.
    const { estado } = this.fabricaPara(dados.tipoCaptacao).criarProjeto(dados);
    validarProjeto(estado.projeto);
    const eventos = await this.recomendar(estado, []);
    return this.salvar(estado, eventos);
  }
  async reavaliar(projetoId: string, alteracoes: Partial<Omit<ProjetoDados, 'id' | 'produtorId' | 'emailProdutor'>>): Promise<EstadoProjeto> {
    const estado = await this.obter(projetoId);
    estado.projeto = { ...estado.projeto, ...alteracoes };
    validarProjeto(estado.projeto);
    estado.excluidos = {};
    for (const convite of estado.convites) if (convite.status === 'pendente' || convite.status === 'aceito') convite.status = 'cancelado';
    const anteriores = estado.equipe.membros;
    const eventos = await this.recomendar(estado, []);
    eventos.unshift(await this.notificar(estado, 'EQUIPE_REAVALIADA', anteriores, { alteracoes }));
    return this.salvar(estado, eventos);
  }
  async decidir(projetoId: string, papel: Papel, acao: 'aceitar' | 'rejeitar' | 'substituir', profissionalId?: string): Promise<EstadoProjeto> {
    const estado = await this.obter(projetoId);
    exigir(estado.projeto.papeis.some(p => p.papel === papel), 'Papel não exigido pelo projeto.');
    const membro = estado.equipe.membros.find(m => m.papel === papel);
    if (acao === 'aceitar') {
      exigir(membro, 'Não há profissional sugerido para esse papel.');
      exigir(!membro.aceitoProdutor, 'Esse profissional já foi aceito pelo produtor.', 409);
      membro.aceitoProdutor = true;
      const convite: Convite = { id: id(), papel, profissionalId: membro.profissionalId, status: 'pendente' };
      estado.convites.push(convite);
      this.atualizarEquipe(estado);
      return this.salvar(estado, [await this.notificar(estado, 'CONVITE_ENVIADO', [membro], { conviteId: convite.id })]);
    }
    exigir(membro || acao === 'substituir', 'Não há membro para rejeitar.');
    if (membro) {
      estado.excluidos[papel] = [...(estado.excluidos[papel] ?? []), membro.profissionalId];
      this.cancelarConvites(estado, papel);
    }
    const fixos = estado.equipe.membros.filter(m => m.papel !== papel);
    const eventos = [await this.notificar(estado, acao === 'rejeitar' ? 'MEMBRO_REJEITADO' : 'MEMBRO_SUBSTITUIDO', membro ? [membro] : [], { papel })];
    if (profissionalId) {
      exigir(!estado.excluidos[papel]?.includes(profissionalId), 'Profissional já rejeitado para esse papel.');
      const { profissionais, degradada } = await this.catalogo.obter();
      exigir(!degradada, 'Não foi possível validar o substituto no catálogo.', 503);
      const candidato = profissionais.find(p => p.id === profissionalId);
      exigir(candidato, 'Profissional não encontrado.', 404);
      const { membros } = this.orquestradorPara(estado.projeto).orquestrar(estado.projeto, [candidato], fixos, estado.excluidos);
      const substituto = membros.find(m => m.papel === papel && m.profissionalId === profissionalId);
      exigir(substituto, 'O substituto não atende ao papel, disponibilidade, localização, nota ou orçamento.');
      fixos.push(substituto);
    }
    eventos.push(...await this.recomendar(estado, fixos));
    return this.salvar(estado, eventos);
  }
  async responderConvite(projetoId: string, conviteId: string, aceitar: boolean): Promise<EstadoProjeto> {
    const estado = await this.obter(projetoId);
    const convite = estado.convites.find(c => c.id === conviteId);
    exigir(convite, 'Convite não encontrado.', 404);
    exigir(convite.status === 'pendente', 'Convite já respondido ou cancelado.', 409);
    const membro = estado.equipe.membros.find(m => m.papel === convite.papel && m.profissionalId === convite.profissionalId);
    exigir(membro, 'O profissional não pertence mais à equipe.', 409);
    convite.status = aceitar ? 'aceito' : 'recusado';
    await this.salvar(estado, [this.formatar(estado, this.evento(aceitar ? 'CONVITE_ACEITO' : 'CONVITE_RECUSADO', projetoId, convite.profissionalId, { conviteId, papel: convite.papel }, [this.produtor(estado)]))]);
    await this.eventos.processar();
    return this.obter(projetoId);
  }
  async aplicarRespostaConvite(evento: EventoRecomendacao): Promise<void> {
    if (evento.tipo !== 'CONVITE_ACEITO' && evento.tipo !== 'CONVITE_RECUSADO') return;
    const estado = await this.obter(evento.projetoId);
    const convite = estado.convites.find(c => c.id === evento.dados.conviteId);
    // O evento pode ser repetido ou chegar depois de uma reavaliação/substituição.
    if (!convite || convite.respostaProcessada || convite.status === 'cancelado') return;
    exigir(convite.status === (evento.tipo === 'CONVITE_ACEITO' ? 'aceito' : 'recusado'), 'Resposta incompatível com o convite.', 409);
    const membro = estado.equipe.membros.find(m => m.papel === convite.papel && m.profissionalId === convite.profissionalId);
    exigir(membro, 'O profissional não pertence mais à equipe.', 409);
    const eventos: EventoRecomendacao[] = [];
    if (convite.status === 'aceito') {
      membro.confirmado = true;
      this.atualizarEquipe(estado);
      if (estado.equipe.status === 'formada') eventos.push(await this.notificar(estado, 'EQUIPE_FORMADA', estado.equipe.membros, { equipe: estado.equipe }));
    } else {
      estado.excluidos[convite.papel] = [...(estado.excluidos[convite.papel] ?? []), convite.profissionalId];
      eventos.push(...await this.recomendar(estado, estado.equipe.membros.filter(m => m.papel !== convite.papel)));
    }
    convite.respostaProcessada = true;
    await this.salvar(estado, eventos);
  }
  private cancelarConvites(estado: EstadoProjeto, papel: Papel): void {
    for (const convite of estado.convites) if (convite.papel === papel && ['pendente', 'aceito'].includes(convite.status)) convite.status = 'cancelado';
  }
  private produtor(estado: EstadoProjeto): Destinatario { return { id: estado.projeto.produtorId, email: estado.projeto.emailProdutor }; }
  private async notificar(estado: EstadoProjeto, tipo: string, membros: Pick<MembroEquipe, 'profissionalId'>[], dados: Record<string, unknown>): Promise<EventoRecomendacao> {
    const { profissionais } = await this.catalogo.obter();
    const envolvidos = new Set(membros.map(m => m.profissionalId));
    return this.formatar(estado, this.evento(tipo, estado.projeto.id, estado.projeto.produtorId, dados,
      [this.produtor(estado), ...profissionais.filter(p => envolvidos.has(p.id)).map(p => ({ id: p.id, email: p.email }))]));
  }
  /** Anexa ao evento o assunto e a mensagem no formato do notificador do tipo de projeto. */
  private formatar(estado: EstadoProjeto, evento: EventoRecomendacao): EventoRecomendacao {
    return { ...evento, ...this.fabricaPara(estado.projeto.tipoCaptacao).criarNotificador().compor(evento.tipo, estado.projeto) };
  }
  private async recomendar(estado: EstadoProjeto, fixos: MembroEquipe[]): Promise<EventoRecomendacao[]> {
    const { profissionais, degradada } = await this.catalogo.obter();
    const resultado = this.orquestradorPara(estado.projeto).orquestrar(estado.projeto, profissionais, fixos, estado.excluidos);
    estado.equipe = { id: estado.equipe.id, membros: resultado.membros, custo: 0, status: 'sugerida' };
    estado.recomendacao = {
      id: id(), criadaEm: agora(), estrategia: estado.projeto.estrategia,
      ranking: Object.fromEntries([...resultado.ranking].map(([papel, candidatos]) => [papel, candidatos.slice(0, 10)])),
      faltantes: resultado.faltantes, degradada,
      avisos: [...(degradada ? ['Catálogo indisponível: utilizando cache recente ou equipe parcial.'] : []),
        ...(resultado.faltantes.length ? ['Não foi encontrada uma equipe completa dentro das restrições.'] : [])],
    };
    this.atualizarEquipe(estado);
    const recomendados = [...resultado.membros, ...Object.values(estado.recomendacao.ranking).flat()];
    return [await this.notificar(estado, 'RECOMENDACAO_GERADA', recomendados, { recomendacaoId: estado.recomendacao.id, estrategia: estado.projeto.estrategia, degradada, faltantes: resultado.faltantes })];
  }
  private atualizarEquipe(estado: EstadoProjeto): void {
    const { equipe, projeto } = estado;
    equipe.custo = equipe.membros.reduce((s, m) => s + centavos(m.preco), 0) / 100;
    const completa = projeto.papeis.every(p => equipe.membros.some(m => m.papel === p.papel));
    equipe.status = !completa ? 'parcial' : equipe.membros.every(m => m.confirmado && m.aceitoProdutor) ? 'formada'
      : equipe.membros.some(m => m.aceitoProdutor) ? 'aguardando' : 'sugerida';
    if (equipe.status === 'formada') equipe.dataFormacao = agora();
    else delete equipe.dataFormacao;
  }
  private async salvar(estado: EstadoProjeto, eventos: EventoRecomendacao[]): Promise<EstadoProjeto> {
    const versao = estado.versao;
    estado.versao++;
    await this.repo.salvarProjeto(estado, versao, eventos);
    void this.eventos.processar();
    return estado;
  }
}
