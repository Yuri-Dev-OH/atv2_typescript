import assert from 'node:assert/strict';
import type { EstadoProjeto } from '../src/domain/model.js';
import { projetoExemplo } from './fixtures.js';

const base = process.env.API_URL ?? 'http://127.0.0.1:3000';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const resposta = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(`${resposta.status}: ${JSON.stringify(dados)}`);
  return dados as T;
}
let estado = await request<EstadoProjeto>('/projetos', projetoExemplo());
const projetoId = estado.projeto.id;
assert.equal(estado.equipe.membros.length, 6, 'Execute npm run db:seed antes da demonstração.');
console.log('Projeto criado:', projetoId);
console.table(estado.equipe.membros.map(m => ({ papel: m.papel, nome: m.nome, preco: m.preco })));
estado = await request(`/projetos/${projetoId}/reavaliar`, { estrategia: 'orcamento', orcamento: 4000 });
console.log('Equipe com estratégia de orçamento: R$', estado.equipe.custo);
estado = await request(`/projetos/${projetoId}/membros/EDITOR`, { acao: 'substituir' });
assert.equal(estado.equipe.membros.length, 6);
for (const membro of estado.equipe.membros) {
  estado = await request(`/projetos/${projetoId}/membros/${membro.papel}`, { acao: 'aceitar' });
  const convite = estado.convites.find(c => c.papel === membro.papel && c.status === 'pendente')!;
  estado = await request(`/projetos/${projetoId}/convites/${convite.id}/responder`, { aceitar: true });
}
assert.equal(estado.equipe.status, 'formada');
const relatorio = await request<{ texto: string }>(`/projetos/${projetoId}/relatorio`);
console.log(relatorio.texto);
console.log(`Auditoria: ${base}/auditoria?projetoId=${projetoId}`);
console.log(`Notificações: ${base}/notificacoes?destinatarioId=produtor-demo`);
