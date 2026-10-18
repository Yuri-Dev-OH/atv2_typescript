# Verificação da atividade

Verificado em 27/09/2026 no Windows e em contêiner Ubuntu 24.04.5 LTS. A execução Ubuntu foi realizada pelo usuário e confirmada pelo log enviado, iniciado às 18:56:10 UTC, com Node 24.21.0 e PostgreSQL 18.6.

| Requisito | Implementação e evidência |
|---|---|
| API REST e persistência | Fastify, TypeORM, migrações e testes `api`/`postgres` |
| Dados do projeto e dos profissionais | Validações de datas, competências, avaliações, pesos, orçamento e faixa de preço |
| Strategy | Cosseno, colaborativa e orçamento; testes `patterns` |
| Template Method | Fluxo de recomendação em `OrquestradorEquipe`; testes `patterns` |
| Observer | Notificações, auditoria e composição após resposta do convite; testes `events`/`composition` |
| Visitor | Consistência, compatibilidade e relatório; testes `patterns` |
| Aceite, recusa, substituição e reavaliação | Testes `api`, preservação dos demais membros e cancelamento de convites antigos |
| Integração de equipe formada | Publicação HTTP, consumidores demonstrativos e repetição idempotente; testes `http-integrations` e `demo:integracoes` |
| Falha de dependência | Catálogo com processo/banco separados, cache e equipe parcial; servidor desligado em testes HTTP e PostgreSQL |
| Cobertura >80% | 46 testes aprovados; linhas 99,43%, instruções 99,18%, funções 99,18%, ramificações 95,90% |
| 10 mil profissionais / 100 concorrentes / <2s | Ubuntu: 100 sucessos; mediana 1046,846 ms, p95 1604,779 ms, máximo 1610,074 ms |
| Diagrama atualizado | `docs/diagrama.puml`; original preservado |
| Ubuntu 24.04 | Build, migrações, 46 testes, carga e demonstração de integração HTTP aprovados; contêiner de validação encerrado com código 0 |

O teste de carga mede requisições HTTP com catálogo aquecido e banco real; seus números dependem da máquina e da carga concorrente. Os testes de indisponibilidade verificam o comportamento separadamente.

A migração do banco de desenvolvimento foi aplicada preservando os projetos. Na validação Ubuntu, os consumidores HTTP confirmaram os estados `em_producao` e `aguardando_pagamento` para a mesma equipe e valor de R$ 7200. O erro de chave duplicada no log é intencional no teste de rollback. A mensagem `Aborting on container exit` corresponde à opção do Compose que encerra os demais serviços quando a validação termina; o código de saída foi 0.

O orquestrador retorna diretamente os melhores candidatos independentes quando não há conflito de profissionais nem excesso de orçamento. Nesse caso, a busca combinatória não pode melhorar a pontuação. Nos outros casos, a busca foi preservada. Também foram removidos cálculos repetidos de normalização e uma passagem desnecessária pelas avaliações. Com a mesma carga local no Windows, houve 100 sucessos e máximo de 1364,266 ms.

Os consumidores externos são demonstrações, e SMTP depende de configuração para envio real. Não se implementaram interface gráfica, menu CLI nem CRUD genérico adicional: a interação requerida acontece pela API REST.
