import os

# Configurações do RoboFluxoB3
MT5_PATH = os.getenv("MT5_PATH", r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe")
ATIVO_ALVO = os.getenv("ATIVO_ALVO", "WINZ26")

# Parâmetros de estratégia
TAMANHO_RANGE_PTS = int(os.getenv("TAMANHO_RANGE_PTS", "100"))
LOTES_TESTE = float(os.getenv("LOTES_TESTE", "1"))
PONTOS_SL = int(os.getenv("PONTOS_SL", "150"))
PONTOS_TP = int(os.getenv("PONTOS_TP", "300"))
MAGIC_NUMBER = int(os.getenv("MAGIC_NUMBER", "202610"))

# Parâmetros de processamento
MAX_BUFFER_TICKS = int(os.getenv("MAX_BUFFER_TICKS", "20000"))
FILA_MAXSIZE = int(os.getenv("FILA_MAXSIZE", "50000"))
TICK_POLL_INTERVAL = float(os.getenv("TICK_POLL_INTERVAL", "0.001"))

# Parâmetros de análise de fluxo tradicional
DESEQUILIBRIO_MINIMO_BOOK = float(os.getenv("DESEQUILIBRIO_MINIMO_BOOK", "2.0"))
THRESHOLD_ABSORCAO = float(os.getenv("THRESHOLD_ABSORCAO", "3.0"))
THRESHOLD_EXAUSTAO = float(os.getenv("THRESHOLD_EXAUSTAO", "0.2"))

# Parâmetros da Estratégia de Renko 10R & Pirâmide de Confluência (Projeto Marcos-Adriano-de-Camargo)
MODO_ESTRATEGIA = os.getenv("MODO_ESTRATEGIA", "RENKO_PIRAMIDE_CONFLUENCIA") # ou "RANGE_FOOTPRINT"
RENKO_BOX_PTS = int(os.getenv("RENKO_BOX_PTS", "50")) # 10R = 50 pontos no Mini-Índice
MIN_DELTA_THRESHOLD = float(os.getenv("MIN_DELTA_THRESHOLD", "150.0"))
CONTRATOS_MAE = float(os.getenv("CONTRATOS_MAE", "1.0"))
CONTRATOS_PIRAMIDE = float(os.getenv("CONTRATOS_PIRAMIDE", "1.0"))
PYRAMID_TP_PTS = int(os.getenv("PYRAMID_TP_PTS", "50"))
MAX_POSICOES_PIRAMIDE = int(os.getenv("MAX_POSICOES_PIRAMIDE", "5"))
HORA_INICIO_TRADING = os.getenv("HORA_INICIO_TRADING", "09:05")
HORA_FIM_ENTRADAS = os.getenv("HORA_FIM_ENTRADAS", "17:40")
HORA_ZERAGEM_OBRIGATORIA = os.getenv("HORA_ZERAGEM_OBRIGATORIA", "17:50")

