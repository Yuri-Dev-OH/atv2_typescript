import Fastify from 'fastify';
import type { Equipe, EventoRecomendacao } from '../domain/model.js';

// Consumidores de demonstração: recebem HTTP e iniciam os fluxos, sem pagamentos reais.
export function criarConsumidor(destino: 'gerenciamento-projetos' | 'processamento-financeiro') {
  const app = Fastify();
  const recebidos = new Set<string>();
  const projetos = new Map<string, { status: string; equipeId: string; profissionais: string[]; valor: number }>();
  app.post<{ Body: EventoRecomendacao & { dados: { equipe: Equipe } } }>('/eventos', { schema: { body: {
    type: 'object', required: ['id', 'tipo', 'projetoId', 'dados'], properties: {
      id: { type: 'string', format: 'uuid' }, tipo: { const: 'EQUIPE_FORMADA' }, projetoId: { type: 'string', format: 'uuid' },
      dados: { type: 'object', required: ['equipe'], properties: { equipe: { type: 'object', required: ['id', 'custo', 'membros'], properties: {
        id: { type: 'string', format: 'uuid' }, custo: { type: 'number', minimum: 0 },
        membros: { type: 'array', minItems: 1, items: { type: 'object', required: ['profissionalId'], properties: { profissionalId: { type: 'string', format: 'uuid' } } } },
      } } } },
    },
  } } }, async (req, reply) => {
    const e = req.body;
    if (req.headers['idempotency-key'] !== e.id) return reply.code(400).send({ erro: 'Chave de idempotência inválida.' });
    if (!recebidos.has(e.id)) {
      projetos.set(e.projetoId, { status: destino === 'gerenciamento-projetos' ? 'em_producao' : 'aguardando_pagamento',
        equipeId: e.dados.equipe.id, profissionais: e.dados.equipe.membros.map(m => m.profissionalId), valor: e.dados.equipe.custo });
      recebidos.add(e.id);
    }
    return { recebido: e.id, destino };
  });
  app.get('/estado', async () => ({ destino, eventosProcessados: recebidos.size, projetos: Object.fromEntries(projetos) }));
  return { app, recebidos, projetos };
}
