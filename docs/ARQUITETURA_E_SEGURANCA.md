# Documentação Técnica: Arquitetura, Hardening e Versionamento

## 1. Visão Geral
Este documento registra a consolidação do sistema **RoboFluxoB3** após a auditoria de segurança e hardening do canal de comunicação WebSocket e proteção das travas de execução do MetaTrader 5.

## 2. Estrutura de Diretórios
```
RoboFluxoB3/
├── bot_mt5_ciclo15.py           # Motor Renko, cálculo de confluência e ponte WebSocket
├── test_paridade_regras.py      # Bateria de testes de paridade (47 asserts)
├── test_diario_eventos.py       # Testes com stubs de MT5 (46 cenários)
├── auditar_pregao.py            # Auditoria de trilha de ordens e PnL por magic
├── _reiniciar_ponte.ps1         # Lançador seguro da ponte (ORDERS_BLOCKED=1)
├── iniciar_robo.cmd             # Script de subida conjunta em modo protegido
├── AGENTS.md                    # Diretrizes obrigatórias de convivência entre IAs
├── README.md                    # Guia geral da plataforma
├── docs/                        # Documentação técnica e relatórios de auditoria
├── data/                        # Fitas históricas de ticks (.csv.gz) e relatórios
└── interface_github/            # Repositório frontend (React 19 / Vite / TypeScript)
    ├── src/
    │   ├── App.tsx              # Componente raiz e sincronização de dados MT5
    │   ├── utils/
    │   │   ├── bridgeSecurity.ts       # Gestão de token e handshake seguro
    │   │   └── convergenceEvaluator.ts # Espelho das regras do motor em TypeScript
    │   └── components/          # Painéis, boletas, auditoria e gráficos Renko
    └── package.json
```

## 3. Gestão de Branches e Versionamento
- **Repositório Backend (`RoboFluxoB3`):**
  - Branch estável: `backend-python`
  - Branch de desenvolvimento/testes: `dev-backend`
- **Repositório Frontend (`interface_github`):**
  - Branch estável: `main`
  - Branch de desenvolvimento/testes: `dev`

## 4. Política de Exclusão de Segredos (.gitignore)
Estão explicitamente ignorados e protegidos contra versionamento:
- `bridge_token.txt` (na raiz e em `interface_github/public/`)
- `*.log` e `*.err` (logs de execução em tempo real)
- `venv/` e `.venv/` (ambientes virtuais locais)
- `node_modules/` e `dist/` (dependências e builds empacotados)
- `data/*.csv.gz` (fitas de replay volumosas)
