import type { ProfissionalDados } from '../domain/model.js';
import type { RepositorioProfissionais } from '../domain/ports.js';

export class CatalogoProfissionais {
  private cache: ProfissionalDados[] = [];
  private atualizado = 0;
  private pendente?: Promise<{ profissionais: ProfissionalDados[]; degradada: boolean }>;
  private invalidado = false;
  constructor(private readonly repo: RepositorioProfissionais, private readonly ttl = 5000) {}
  invalidar(): void { this.invalidado = true; }
  async obter(): Promise<{ profissionais: ProfissionalDados[]; degradada: boolean }> {
    if (!this.invalidado && this.atualizado && Date.now() - this.atualizado < this.ttl) return { profissionais: this.cache, degradada: false };
    if (this.pendente) return this.pendente;
    this.pendente = this.carregar().finally(() => { this.pendente = undefined; });
    return this.pendente;
  }
  private async carregar(): Promise<{ profissionais: ProfissionalDados[]; degradada: boolean }> {
    try {
      this.cache = await this.repo.listarProfissionais();
      this.atualizado = Date.now();
      this.invalidado = false;
      return { profissionais: this.cache, degradada: false };
    } catch {
      // Cache de até cinco minutos. Sem cache, devolve uma recomendação parcial vazia.
      return { profissionais: Date.now() - this.atualizado < 300000 ? this.cache : [], degradada: true };
    }
  }
}
