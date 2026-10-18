import type { EventoRecomendacao, ProfissionalDados } from '../domain/model.js';
import type { PublicadorIntegracao, RepositorioProfissionais } from '../domain/ports.js';

export class CatalogoHttp implements RepositorioProfissionais {
  constructor(private readonly url: string, private readonly timeout = 700) {}
  async listarProfissionais(): Promise<ProfissionalDados[]> {
    const resposta = await fetch(`${this.url}/profissionais`, { signal: AbortSignal.timeout(this.timeout) });
    if (!resposta.ok) throw new Error(`Catálogo retornou HTTP ${resposta.status}.`);
    const dados: unknown = await resposta.json();
    if (!Array.isArray(dados)) throw new Error('Resposta inválida do catálogo.');
    return dados as ProfissionalDados[];
  }
  async salvarProfissional(p: ProfissionalDados): Promise<void> {
    const { id, ...dados } = p;
    const resposta = await fetch(`${this.url}/profissionais/${id}`, { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados), signal: AbortSignal.timeout(this.timeout) });
    if (!resposta.ok) throw new Error(`Cadastro recusado pelo catálogo: HTTP ${resposta.status}.`);
  }
}
export class PublicadorHttp implements PublicadorIntegracao {
  constructor(private readonly destinos: Record<string, string>, private readonly timeout = 1000) {}
  async publicar(destino: string, evento: EventoRecomendacao): Promise<void> {
    const url = this.destinos[destino];
    if (!url) throw new Error(`Destino não configurado: ${destino}.`);
    const resposta = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': evento.id },
      body: JSON.stringify(evento), signal: AbortSignal.timeout(this.timeout) });
    if (!resposta.ok) throw new Error(`Entrega para ${destino} retornou HTTP ${resposta.status}.`);
  }
}
