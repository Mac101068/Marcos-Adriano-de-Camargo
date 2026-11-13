---
name: teste-robos-hedge-reais
description: >-
  Protocolo de ativação, ensaio e auditoria dos robôs hedge direcionais (RoboCompra magic 100001 e RoboVenda magic 100002)
  utilizando dados reais de pregão via replay (cache rolante / fita real MT5) sem envio de ordens reais e sem novos downloads de ticks.
---

# Teste e Ativação dos Robôs Hedge com Dados Reais

Este manual define o procedimento padrão para ensaiar, verificar isolamento de magic e auditar a performance dos robôs direcionais (Hedge) no ambiente de replay/simulação.

## Diretrizes e Regras Fixas

1. **Segurança Absoluta da Conta Real:** Replay, simulação e robôs sombra jamais tocam a corretora real.
2. **Sem Novos Downloads de Ticks:** O projeto já possui fitas e caches prontos em `data/` e `marketHistoryService`. Nunca rebaixar ticks da corretora a menos que explicitamente solicitado pelo Marcos (~170 MB/mês).
3. **Controle de Versão:** Commitar somente sob pedido do Marcos.
4. **Isolamento de Magic Numbers:**
   - Robô 1 Principal: `102030`
   - Boleta Manual: `999999`
   - Robô Direcional Compra: `100001`
   - Robô Direcional Venda: `100002`

---

## Parte 1 — Habilitar os Robôs no Painel

1. **Confirmar Pré-requisitos:**
   - Feed do replay ou ponte local conectado.
   - `directionalRobotService` instanciado no `App.tsx` com `BUY (100001)` e `SELL (100002)`.
   - TypeScript limpo (`npx tsc --noEmit`).
2. **Ativação dos Cartões:**
   - No painel de automação, ativar cada robô pelo seu respectivo cartão (`activate(100001)` / `activate(100002)`).
   - **Atenção:** Os robôs nascem **PAUSADOS** por segurança.
3. **Conferência Prévia:**
   - Trava de Direção (`directionLock`): `BUY_ONLY` no RoboCompra, `SELL_ONLY` no RoboVenda.
   - `onCloseOpposite`: Inicia como `false`. Ligar apenas no teste específico de encerramento por sinal contrário.
   - Verificar que a boleta (`999999`) e o Robô 1 (`102030`) permanecem completamente isolados.
   - Os robôs direcionais são **exceção do ARM**: `100001` e `100002` despacham mesmo com a ponte em `EM SEGURO`, igual à boleta (`999999`), ao Copiloto e aos varais — o cartão do robô é o consentimento explícito do operador.
   - A barreira contra ordem real em conta real é a **trava de ambiente**: `ORDERS_BLOCKED=1` (definida no `iniciar_robo.cmd`) ou o modo `Replay` da tela. Ela segura a ENTRADA dos dois magics **acima** do ARM, inclusive com `ARM` liberado. Saídas (parcial, stop, zeragem) seguem liberadas de propósito.

---

## Parte 2 — Teste com Dados Reais (Replay do Catálogo)

### Fontes de Dados Existentes
- **Cache rolante de 10 dias (`marketHistoryService`):** CSV determinístico por pregão, carregamento instantâneo.
- **Fitas reais MT5 em `data/`:** Arquivos reais de `WINZ26`, `WDOZ26` e `BITX26` (armazenados em `data/` e `data/pregoes/`).
- **Catálogo de Pregões (`pregoesCatalogService`):** Seleção direta do dia no painel.

### Protocolo de Execução
1. Abrir o modo Replay com pregão real do catálogo (ex: dia direcional de abertura vs dia lateral).
2. Ativar e despausar os dois robôs direcionais.
3. Executar o pregão na velocidade desejada.
4. Coletar e verificar as seguintes métricas em tabela:
   - Contagem de intenções: Apenas `BUY` no `100001`; apenas `SELL` no `100002`.
   - PnL por robô coerente com preço de entrada vs saída.
   - Teste de `onCloseOpposite = true`: Sinal contrário deve fechar exclusivamente as posições daquele robô, gerando motivo `OPPOSITE_ROBOT_SIGNAL` e registrando o magic na trilha de auditoria.
   - Robô pausado: Deve registrar rigorosamente **zero intenções**.
   - Robô 1 (`102030`) e Boleta (`999999`) inalterados.
5. Repetir com pelo menos 2 pregões com dinâmicas de mercado distintas.

---

## Parte 3 — Validação Técnica e Sanity Checks

Antes de finalizar qualquer rodada de testes:
```bash
# 1. Checagem de tipos estáticos
cd interface_github
npx tsc --noEmit

# 2. Asserção estrita dos Magic Numbers e regras financeiras
npx tsx scripts/robotMagicAssert.ts

# 3. Build de produção do Vite
npx vite build
```

---

## Checklist do Relatório Final
Ao entregar os resultados ao Marcos, apresentar:
- [ ] Tabela comparativa dos pregões testados (Ativo, Data, Intenções Compra/Venda, PnL, Win Rate).
- [ ] Confirmação do teste de `onCloseOpposite` com evidência do log de auditoria.
- [ ] Resultado dos 3 comandos de validação (`tsc`, `robotMagicAssert`, `vite build`).
- [ ] Relatório honesto: lista explícita do que foi verificado vs o que ficou sem teste.

