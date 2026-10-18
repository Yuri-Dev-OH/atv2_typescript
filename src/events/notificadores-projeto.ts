import type { ProjetoDados } from '../domain/model.js';
import type { RestricoesAnimacao, RestricoesDocumentario, RestricoesPublicitario } from '../domain/projetos.js';
import { horasRender } from '../domain/validadores.js';

export interface MensagemProjeto { assunto: string; mensagem: string }
/** Produto da fábrica: formato das notificações de um tipo de projeto. */
export interface NotificadorProjeto {
  /**
   * @param tipoEvento Tipo do evento, como RECOMENDACAO_GERADA.
   * @param projeto Projeto ao qual o evento se refere.
   * @returns Assunto e corpo usados pelos canais de e-mail e mensagens internas.
   */
  compor(tipoEvento: string, projeto: ProjetoDados): MensagemProjeto;
}

/** Mantém o formato da atividade 1. */
export class NotificadorFiccao implements NotificadorProjeto {
  compor(tipoEvento: string, p: ProjetoDados): MensagemProjeto {
    return { assunto: 'Cinebridge', mensagem: `${tipoEvento}: projeto ${p.id}` };
  }
}
export class NotificadorDocumentario implements NotificadorProjeto {
  constructor(private readonly restricoes: RestricoesDocumentario) {}
  compor(tipoEvento: string, p: ProjetoDados): MensagemProjeto {
    const imagem = this.restricoes.exigeDireitoImagem ? '; termo de direito de imagem obrigatório' : '';
    return { assunto: `Cinebridge | Documentário: ${p.titulo}`,
      mensagem: `${tipoEvento}: documentário "${p.titulo}" (${p.id}). Captação em ${p.localizacao}${imagem}.` };
  }
}
export class NotificadorAnimacao implements NotificadorProjeto {
  constructor(private readonly restricoes: RestricoesAnimacao) {}
  compor(tipoEvento: string, p: ProjetoDados): MensagemProjeto {
    const { softwares3D, minutosRenderPorMinuto } = this.restricoes;
    return { assunto: `Cinebridge | Animação: ${p.titulo}`,
      mensagem: `${tipoEvento}: animação "${p.titulo}" (${p.id}). Pipeline ${softwares3D.join('/')}; render estimado de `
        + `${horasRender(p.duracao, this.restricoes)} h (${minutosRenderPorMinuto} min de máquina por minuto de obra).` };
  }
}
export class NotificadorPublicitario implements NotificadorProjeto {
  constructor(private readonly restricoes: RestricoesPublicitario) {}
  compor(tipoEvento: string, p: ProjetoDados): MensagemProjeto {
    const aprovacao = this.restricoes.aprovacaoCliente ? '; cada corte exige aprovação do cliente' : '';
    return { assunto: `Cinebridge | Publicidade: ${p.titulo}`,
      mensagem: `${tipoEvento}: peça publicitária "${p.titulo}" (${p.id}). Entrega até ${p.prazo}${aprovacao}.` };
  }
}
