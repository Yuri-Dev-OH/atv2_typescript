import { expect, it } from 'vitest';
import { ControleConcorrencia } from '../src/http/concurrency.js';

it('limita operações ativas e libera a fila mesmo depois de erro', async () => {
  const controle = new ControleConcorrencia(2);
  const gate = Promise.withResolvers<void>();
  let ativos = 0, maximo = 0;
  const resultados = Promise.allSettled(Array.from({ length: 20 }, (_, i) => controle.executar(async () => {
    ativos++;
    maximo = Math.max(maximo, ativos);
    await gate.promise;
    ativos--;
    if (i === 0) throw new Error('Falha de gravação');
    return i;
  })));
  expect(ativos).toBe(2);
  gate.resolve();
  const concluidos = await resultados;
  expect(maximo).toBe(2);
  expect(concluidos.filter(r => r.status === 'fulfilled')).toHaveLength(19);
  expect(concluidos.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(await controle.executar(async () => 'livre')).toBe('livre');
});
