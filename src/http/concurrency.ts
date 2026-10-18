export class ControleConcorrencia {
  private ativos = 0;
  private readonly fila: (() => void)[] = [];
  constructor(private readonly limite = 16) {}

  async executar<T>(operacao: () => Promise<T>): Promise<T> {
    if (this.ativos >= this.limite) await new Promise<void>(resolve => this.fila.push(resolve));
    else this.ativos++;
    try { return await operacao(); }
    finally {
      const proximo = this.fila.shift();
      if (proximo) proximo();
      else this.ativos--;
    }
  }
}
