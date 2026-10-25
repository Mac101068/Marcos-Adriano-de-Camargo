# RoboFluxoB3 - Painel Web

## Instalação

1. Instale as dependências:
```bash
pip install -r requirements.txt
```

2. Certifique-se de que o MetaTrader 5 está instalado e configurado com uma conta DEMO.

## Como usar

1. Inicie o servidor web:
```bash
python main.py
```

2. Acesse o painel: http://127.0.0.1:8000

3. No painel você pode:
   - Visualizar status do robô e conta MT5
   - Iniciar/Parar o robô
   - Acompanhar logs em tempo real
   - Ver sinais detectados e ordens enviadas

## Segurança

- O sistema bloqueia automaticamente execução em conta REAL
- Apenas funciona com conta DEMO ou CONTEST
- Todas as ordens são enviadas com SL/TP
- Normalização de preços conforme regras da B3
