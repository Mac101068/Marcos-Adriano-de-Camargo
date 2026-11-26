# -*- coding: utf-8 -*-
"""
coletor_microestrutura.py — Laboratório Quantitativo de Microestrutura RoboFluxoB3
Foco: WIN e WDO (B3 Futuros).

Objetivo:
Coletar dados reais em alta resolução (Time & Sales, Agressão B3, Bid/Ask e Spread)
com thread dedicada de gravação não-bloqueante (Queue I/O) e rotação horária/tamanho.

Princípios:
- Sem look-ahead bias na gravação do fluxo original.
- Resolução temporal máxima (ms da bolsa + ns de recepção local no Python).
- Desacoplamento total do loop do MT5 para não induzir lag ou perda de ticks.
- Segurança inegociável: passivo, leitura pura, sem ordens.
"""

import os
import sys
import time
import csv
import queue
import threading
from datetime import datetime
from typing import Optional, Dict, Any

# Diretório padrão para gravação dos arquivos quantitativos
PASTA_MICROESTRUTURA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "microestrutura")

COLUNAS_MICROESTRUTURA = [
    # A. Identificação e Tempo
    "timestamp_evento_msc",              # Timestamp nativo do tick na B3 (ms)
    "timestamp_recebimento_python_ns",   # Timestamp local no Python (ns) via time.time_ns()
    "hora_formatada",                    # HH:MM:SS.mmm para inspeção humana ágil
    "ativo",                             # WINZ26, WDOZ26, etc.
    "fonte_dado",                        # VIVO_MT5, REPLAY, TESTE
    "sequencia_evento",                  # Contador sequencial monotônico por ativo/sessão
    
    # B. Dados de Preço e Spread (no momento exato do negócio)
    "preco_ultimo",                      # Preço executado do negócio
    "preco_bid",                         # Melhor oferta de compra no instante
    "preco_ask",                         # Melhor oferta de venda no instante
    "spread_pontos",                     # Ask - Bid no instante
    
    # C. Time & Sales e Agressão Real B3
    "volume_negocio",                    # Contratos negociados no evento
    "agressao_compra",                   # 1 se agressor comprador, 0 cc
    "agressao_venda",                    # 1 se agressor vendedor, 0 cc
    "lado_agressor",                     # BUY, SELL, CROSS (direto/leilão)
    "lado_agressor_estimado",            # 0 (B3 entrega o agressor real nativo via flags)
    "delta_negocio",                     # +volume (se BUY), -volume (se SELL), 0 (se CROSS)
    "delta_acumulado_sessao",            # Delta cumulativo desde o início da captura
    "volume_acumulado_sessao",           # Volume total negociado na sessão
    
    # D. Dados do Book (Ressalva Crítica: marcado como indisponível/instável)
    "book_status",                       # "book_indisponivel_instavel"
    "quantidade_bid",                    # None / vazio
    "quantidade_ask",                    # None / vazio
    "desequilibrio_book",                # None / vazio
    
    # E. Variáveis Quantitativas Derivadas
    "eficiencia_fluxo",                  # delta_acumulado / volume_acumulado [-1.0 a +1.0]
    "velocidade_negocios_1s",            # Taxa de negócios por segundo nos últimos 1000ms
    
    # F. Relação com Sinais Existentes do Motor
    "sinal_ativo",                       # 1 se houve sinal de estratégia associado, 0 cc
    "sinal_tipo",                        # BUY, SELL ou vazio
    "sinal_motivo",                      # Motivo do sinal do motor
    "sinal_box_index",                   # Índice do box correspondente
]

class MicrostructureCollector:
    """
    Coletor de microestrutura com fila em memória (Queue) e thread dedicada de I/O.
    Garante zero bloqueio no loop de ticks do MT5 e rotação horária de arquivos CSV.
    """
    _instance = None
    # RLock: get_instance() segura o lock e chama start(), que pega o mesmo lock.
    # Com Lock comum isso era deadlock no import e travava a ponte antes do 1º print.
    _lock = threading.RLock()

    def __init__(self, output_dir: str = PASTA_MICROESTRUTURA, max_queue_size: int = 200000):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)
        
        self.queue: queue.Queue = queue.Queue(maxsize=max_queue_size)
        self.running = False
        self.writer_thread: Optional[threading.Thread] = None
        
        # Contadores de auditoria e performance
        self.contadores = {
            "recebidos": 0,
            "gravados": 0,
            "descartados_fila_cheia": 0,
            "erros_escrita": 0,
        }
        
        # Estado por ativo
        self.state_por_ativo: Dict[str, Dict[str, Any]] = {}
        
        # Controle de arquivo aberto
        self.current_file = None
        self.current_writer = None
        self.current_key = None  # (ativo, yyyymmdd_hh)
        self.current_file_size = 0
        self.max_file_size_bytes = 100 * 1024 * 1024  # Rotação em 100 MB

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = MicrostructureCollector()
                cls._instance.start()
            return cls._instance

    def start(self):
        with self._lock:
            if not self.running:
                self.running = True
                self.writer_thread = threading.Thread(target=self._writer_loop, name="MicrostructureWriter", daemon=True)
                self.writer_thread.start()
                print(" 🔬 [LAB QUANT] Coletor de Microestrutura inicializado com sucesso (I/O assíncrono).", flush=True)

    def stop(self):
        self.running = False
        if self.writer_thread and self.writer_thread.is_alive():
            self.writer_thread.join(timeout=3.0)
        self._fechar_arquivo_atual()

    def _get_or_create_asset_state(self, symbol: str) -> Dict[str, Any]:
        if symbol not in self.state_por_ativo:
            self.state_por_ativo[symbol] = {
                "sequencia": 0,
                "delta_acumulado": 0,
                "volume_acumulado": 0,
                "recent_timestamps": [],  # Timestamps dos últimos 1s para calcular velocidade
            }
        return self.state_por_ativo[symbol]

    def registrar_evento(
        self,
        symbol: str,
        preco: float,
        volume: int,
        aggressor: str,
        ts_msc: int,
        bid: Optional[float] = None,
        ask: Optional[float] = None,
        fonte: str = "VIVO_MT5",
        sinal_info: Optional[Dict[str, Any]] = None
    ):
        """
        Ponto de entrada chamado a cada tick/negócio.
        Execução ultra-rápida (non-blocking).
        """
        self.contadores["recebidos"] += 1
        ts_local_ns = time.time_ns()
        
        st = self._get_or_create_asset_state(symbol)
        st["sequencia"] += 1
        seq = st["sequencia"]
        
        # Classificação de agressão
        aggressor_u = str(aggressor or "").upper()
        is_buy = 1 if aggressor_u in ("BUY", "C", "COMPRA") else 0
        is_sell = 1 if aggressor_u in ("SELL", "V", "VENDA") else 0
        lado = "BUY" if is_buy else ("SELL" if is_sell else "CROSS")
        
        delta_tick = volume if is_buy else (-volume if is_sell else 0)
        st["delta_acumulado"] += delta_tick
        st["volume_acumulado"] += volume
        
        # Eficiência de fluxo: Delta / Volume total (indica facilidade de agressão direcional)
        eficiencia = (st["delta_acumulado"] / st["volume_acumulado"]) if st["volume_acumulado"] > 0 else 0.0
        
        # Velocidade de negócios (janela deslizante de 1000ms)
        ts_sec_thresh = ts_msc - 1000
        st["recent_timestamps"].append(ts_msc)
        while st["recent_timestamps"] and st["recent_timestamps"][0] < ts_sec_thresh:
            st["recent_timestamps"].pop(0)
        velocidade_1s = len(st["recent_timestamps"])
        
        # Preço bid/ask e spread
        p_bid = float(bid) if bid and bid > 0 else preco
        p_ask = float(ask) if ask and ask > 0 else preco
        spread = round(p_ask - p_bid, 4)
        
        # Data e hora formatadas
        hora_fmt = datetime.fromtimestamp(ts_msc / 1000).strftime("%H:%M:%S.%f")[:-3]
        
        # Sinais operacionais vinculados
        tem_sinal = 1 if sinal_info else 0
        sinal_tipo = sinal_info.get("signal", "") if sinal_info else ""
        sinal_motivo = sinal_info.get("reason", "") if sinal_info else ""
        sinal_box = sinal_info.get("boxIndex", "") if sinal_info else ""

        registro = [
            ts_msc,
            ts_local_ns,
            hora_fmt,
            symbol,
            fonte,
            seq,
            preco,
            p_bid,
            p_ask,
            spread,
            volume,
            is_buy,
            is_sell,
            lado,
            0,  # lado_agressor_estimado = 0 (agressor real da B3)
            delta_tick,
            st["delta_acumulado"],
            st["volume_acumulado"],
            "book_indisponivel_instavel",  # D. Book
            "",
            "",
            "",
            round(eficiencia, 6),
            velocidade_1s,
            tem_sinal,
            sinal_tipo,
            sinal_motivo,
            sinal_box,
        ]

        try:
            self.queue.put_nowait(registro)
        except queue.Full:
            self.contadores["descartados_fila_cheia"] += 1

    def obter_estatisticas(self) -> Dict[str, int]:
        stats = dict(self.contadores)
        stats["na_fila"] = self.queue.qsize()
        return stats

    def _obter_caminho_arquivo(self, symbol: str, ts_msc: int, parte: int = 0) -> str:
        dt = datetime.fromtimestamp(ts_msc / 1000)
        dia_str = dt.strftime("%Y%m%d")
        hora_str = dt.strftime("%H")
        sufixo = f"_p{parte}" if parte > 0 else ""
        nome_arq = f"LAB_MICROESTRUTURA_{symbol}_{dia_str}_{hora_str}{sufixo}.csv"
        return os.path.join(self.output_dir, nome_arq), (symbol, f"{dia_str}_{hora_str}")

    def _fechar_arquivo_atual(self):
        if self.current_file:
            try:
                self.current_file.flush()
                self.current_file.close()
            except Exception:
                pass
            self.current_file = None
            self.current_writer = None
            self.current_key = None
            self.current_file_size = 0

    def _writer_loop(self):
        batch = []
        last_flush_time = time.time()

        while self.running or not self.queue.empty():
            try:
                item = self.queue.get(timeout=0.2)
                batch.append(item)
            except queue.Empty:
                pass

            now = time.time()
            # Descarrega em disco se acumulou 500 registros ou se passaram 0.5s
            if batch and (len(batch) >= 500 or (now - last_flush_time) >= 0.5):
                self._escrever_lote(batch)
                batch.clear()
                last_flush_time = now

        if batch:
            self._escrever_lote(batch)
            batch.clear()
        self._fechar_arquivo_atual()

    def _escrever_lote(self, batch):
        if not batch:
            return

        for reg in batch:
            ts_msc = reg[0]
            symbol = reg[3]
            caminho, arq_key = self._obter_caminho_arquivo(symbol, ts_msc)

            # Rotação por mudança de hora/ativo ou por limite de tamanho de 100MB
            if arq_key != self.current_key or self.current_file_size >= self.max_file_size_bytes:
                self._fechar_arquivo_atual()
                self.current_key = arq_key
                # Pula para a primeira parte (_p1, _p2...) que ainda cabe no limite
                parte = 0
                while os.path.exists(caminho) and os.path.getsize(caminho) >= self.max_file_size_bytes:
                    parte += 1
                    caminho, _ = self._obter_caminho_arquivo(symbol, ts_msc, parte)
                novo = not os.path.exists(caminho) or os.path.getsize(caminho) == 0
                try:
                    self.current_file = open(caminho, "a", newline="", encoding="utf-8")
                    self.current_writer = csv.writer(self.current_file)
                    if novo:
                        self.current_writer.writerow(COLUNAS_MICROESTRUTURA)
                        self.current_file.flush()
                    self.current_file_size = os.path.getsize(caminho)
                except Exception as exc:
                    self.contadores["erros_escrita"] += 1
                    print(f"❌ [LAB QUANT ERRO] Falha ao abrir CSV de microestrutura: {exc}", flush=True)
                    continue

            try:
                self.current_writer.writerow(reg)
                self.contadores["gravados"] += 1
                self.current_file_size = self.current_file.tell()
            except Exception as exc:
                self.contadores["erros_escrita"] += 1

        if self.current_file:
            try:
                self.current_file.flush()
            except Exception:
                pass


# Singleton global pronto para importação
collector = MicrostructureCollector.get_instance()
