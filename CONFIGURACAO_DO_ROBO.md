# RoboFluxoB3 — Configuração do Robô & Handover de Sessão
**Data da Atualização:** 09 de Novembro de 2026 (22:50 BRT)  
**Tópico / Nova Conversa:** Configuração do Robô  
**Ambiente:** Windows 11 · MetaTrader 5 XP Demo (`#50534540`) · Vite / React 18 · Python 3.12 (venv)

---

## 1. Topologia e Serviços Ativos

```
┌────────────────────────────────────────────────────────────────────────┐
│                   FRONTEND WEB (React 18 + Vite)                       │
│  - URL Local: http://localhost:3000                                    │
│  - Diretório: RoboFluxoB3\interface_github                             │
│  - Motor Renko: RenkoFlowEngine (TypeScript nativo)                   │
│  - Conexão WebSocket: ws://localhost:8765 ou ws://192.168.18.154:8765 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ WebSocket (JSON RPC / Eventos)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   BACKEND / PONTE MT5 (Python 3.12)                    │
│  - Script Ativo: bot_mt5_ciclo15.py                                    │
│  - Diretório: RoboFluxoB3                                              │
│  - Corretora: XP Investimentos (Conta Demo #50534540)                  │
│  - Ativo Operado: WINZ26 (Mini-Índice B3)                              │
│  - Backfill de Sessão: Reconstrução M1 para ticks do dia               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Consolidação Visual das 3 Linhas do Topo

### Linha 1: Cabeçalho Principal (`Header.tsx` & `SubscriptionStatusBadge.tsx`)
- **Altura Padronizada:** A barra do cabeçalho possui `h-8` (32px), e todas as caixas/botões internos possuem altura uniforme de **`h-6` (24px)** com cantos arredondados `rounded-md`.
- **Alinhamento dos Elementos:**
  1. *Esquerda (Identidade & Ativo):* `Flow Quant MT5` (título em texto puro), Seletor do Ativo (`WINZ26` com `h-6`) e Selo de Estratégia Ativa (`EA Pirâmide Flow` com `h-6`).
  2. *Centro (Navegação):* Menus suspensos agrupados (`Gráficos`, `Análise`, `Sistema`) e atalhos flutuantes (`Dados`, `Box Renko`), todos com `h-6` e tipografia `text-[10px]`.
  3. *Direita (Controles de Execução):*
     - **Ponte MT5:** Ícone Wifi + indicador LED de status (`h-6 px-2`).
     - **Caixa On/Off (Robô Automático):** Ajustada para `h-6 px-2 text-[10px] font-semibold`. Não destoa mais das caixas irmãs e fica visualmente equilibrada.
     - **Feed de Simulação (Rodar/Pausar):** `h-6 px-2 text-[10px]`.
     - **PDF Dossiê:** `h-6 px-2 text-[10px]`.
     - **Status de Assinatura / Admin:** `h-6 px-2 text-[10px]` com dropdown de perfil.

### Linha 2: Tira de Métricas e Replay (`App.tsx`)
- **Botão Opera:** Alinhado horizontalmente na mesma posição e estilo compacto da linha de status (`h-6 px-2 rounded border text-[11px] font-semibold`).
- **Seletor de Pregões:** Dropdown nativo com chip resumido (`Flow1`, `Flow2`), evitando poluição horizontal.

### Linha 3: Barra de Ferramentas Colada no Gráfico Renko (`RenkoFlowChart.tsx`)
- **Remoção de Elementos Obsoletos:**
  - Botão lateral `Controles` e gaveta lateral de configuração foram completamente eliminados.
  - Texto redundante `"Aguardando Sinal"` removido globalmente (interno e externo).
  - Ocultação condicional de `[INDICADORES]` e `[CICLOS]` no navegador embutido da IDE (`isInternalBrowser = true`) para evitar sobreposição com o seletor de estratégias e a boleta de ordens.
- **Limpeza da Caixa do Ativo:**
  - Removido o rótulo `| Preço: 171.444 pts`. A caixa agora contém apenas o chip com indicador e o código do papel (`WINZ26`), economizando mais de 130px horizontais.
  - O seletor de gráfico foi encostado logo ao lado com `gap-1.5`.
- **Desobstrução do Robô 2 (+ Sombra):**
  - Removido o botão de atalho a parâmetros `(50p)` no seletor Renko.
  - Removido o contador textual `{boxes.length} blk`.
  - O botão do **Robô 2 (+ Sombra)** recebeu `shrink-0` e tem espaço total desimpedido para exibição contínua.

---

## 3. Correção do Motor Renko no Backfill da Sessão

- **Causa Raiz:** Fora do horário de pregão da B3, a ponte MT5 transmite a carga inicial via `SESSION_BACKFILL` enviando os ticks reconstruídos do dia em `payload.data.ticks`. O frontend procurava apenas `payload.data.boxes`, resultando em um gráfico vazio.
- **Implementação Realizada ([`App.tsx`](file:///c:/Users/Lucas/Documents/RoboFluxoB3/interface_github/src/App.tsx#L5030-L5055)):**
  ```typescript
  } else if (incomingTicks.length > 0) {
    const tempEngine = new RenkoFlowEngine(bfBoxPoints, bfAssetSpec);
    const firstTick = incomingTicks[0];
    if (firstTick && firstTick.price > 0) {
      tempEngine.initialize(firstTick.price, firstTick.timestamp);
    }
    for (const t of incomingTicks) {
      if (t && t.price > 0) {
        tempEngine.processTick(t, config);
      }
    }
    rawBfBoxes = tempEngine.getBoxes();
  }
  ```
- **Resultado:** Abertura imediata do gráfico com os tijolos de Renko perfeitamente traçados ao conectar na ponte, mesmo com o mercado fechado.

---

## 4. Histórico de Commits Recentes

### Submódulo `interface_github` (Rama `main`):
| Hash | Mensagem |
|---|---|
| `c13ee21` | `style(chart): remove botao obsoleto controles e gaveta lateral` |
| `558c610` | `style(layout): alinha caixa opera e caixa winz26 verticalmente com o titulo Flow` |
| `ec37a48` | `style(layout): otimiza espaco para navegador interno e remove texto aguardando sinal` |
| `d19ddc9` | `fix(backfill): processa ticks de SESSION_BACKFILL no motor renko quando boxes nao vierem pre-computados` |
| `e554cb4` | `style(header): padroniza altura das caixas para h-6 e ajusta fonte da caixa On e botoes irmaos` |
| `18a1c5b` | `style(chart-toolbar): remove preco para deixar apenas o simbolo winz26 e dar espaco ao chip Sombra` |
| `79ab0d3` | `style(chart-toolbar): remove atalho de parametros e contador de boxes blk` |

### Repositório Principal `RoboFluxoB3` (Rama `main`):
| Hash | Mensagem |
|---|---|
| `f268fb2` | `chore(submodule): atualiza interface_github removendo atalho de parametros e contador de blk` |
| `a118323` | `chore(submodule): atualiza interface_github com remocao de preco na linha do grafico e visibilidade da Sombra` |
| `8ef5c9e` | `chore(submodule): atualiza interface_github com padronizacao de altura e fonte do header` |
| `553dd5c` | `chore(submodule): atualiza interface_github com correcao de backfill do grafico Renko` |
| `0d57d2e` | `chore(submodule): atualiza interface_github com otimizacao de espaco para navegador interno` |
| `797f575` | `chore(submodule): atualiza interface_github com alinhamento das caixas opera e winz26` |
| `c8bbabd` | `chore(submodule): atualiza interface_github sem botao obsoleto de controles` |

---

## 5. Como Iniciar o Projeto em uma Nova Sessão

### Terminal 1: Ponte MT5 (Python Backend)
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Terminal 2: Servidor Vite (Frontend Web)
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npm run dev
```

### Para Sincronizar com o Repositório Remoto no GitHub:
Como o repositório utiliza autenticação HTTPS (`https://github.com/Mac101068/Marcos-Adriano-de-Camargo.git`), caso o Git Credential Manager solicite autenticação, confirme na janela interativa do navegador ou terminal:
```powershell
# No submódulo:
cd "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
git push origin main

# No repositório raiz:
cd "C:\Users\Lucas\Documents\RoboFluxoB3"
git push origin main
```

---

## 6. Evolução Multi-Robôs & Modo Copiloto (10 de Novembro de 2026)

### Arquitetura Multi-Ativos (Índice, Dólar e Bitcoin)
1. **Ponte & Backend (`bot_mt5_ciclo15.py`):**
   - Suporte a modos operacionais dedicados por ativo: `ROBOT_MODES = {"WIN": "COPILOT", "WDO": "COPILOT", "BIT": "COPILOT"}`.
   - O EA principal processa Times & Trades e Renko dos 3 ativos em paralelo (`WINZ26`, `WDOZ26`, `BITX26`).
   - Quando um sinal de confluência é gerado, se o ativo estiver no modo `COPILOT`, a ordem **não é enviada cegamente a mercado**: o sinal é transmitido via WebSocket (`SIGNAL_GENERATED`) e fica pronto para admissão/execução pelo operador.
   - Sincronização via evento `SET_ROBOT_MODE` entre frontend e backend.

2. **Interface Visual 1 — Tira / Mini-cards Compactos (`MultiAssetRobotsBar.tsx`):**
   - Integrada na barra de ferramentas do gráfico Renko.
   - Exibe os 3 ativos (`WIN`, `WDO`, `BIT`) com LED de status, modo (`COP`, `AUT`, `SOM`), PnL ao vivo em R$ e botão de disparo imediato `[⚡ BUY / SELL]` ao surgir sinal de confluência.

3. **Interface Visual 2 — Janela Flutuante com Abas por Ativo (`MultiAssetRobotsPanel.tsx`):**
   - Janela flutuante (`DadosPanelWindow`) com abas `[WIN]`, `[WDO]` e `[BIT]`.
   - Alternância de modo (`Copiloto` / `Automático` / `Sombra`), visualização do último sinal do EA com motivo e horário, PnL e posições abertas no MT5 com botão de zeragem, além de ajuste de contratos e stops por ativo.


