# -*- coding: utf-8 -*-
"""
Bateria de testes unitários de regras de risco (Risk Management Rules).
Testa:
1. Perfil dinâmico de Stop Loss / Take Profit mínimo por ativo (ASSET_MIN_STOPS).
2. Validação e bloqueio inegociável de ordens com stops inseguros (validate_order_stops).
3. Configuração e execução do Hard Cap emergencial por Magic Number (MAGIC_HARD_CAPS).

Pode ser executado com o terminal MetaTrader fechado (mocks automáticos via unittest.mock).
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch

# Configuração de encoding UTF-8 para stdout em ambientes Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Garante inclusão do diretório raiz
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Mock defensivo do módulo MetaTrader5 se necessário antes do import
try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = MagicMock()
    sys.modules["MetaTrader5"] = mt5

import bot_mt5_ciclo15 as bot


class TestAssetMinStops(unittest.TestCase):
    """Valida o perfil de SL/TP dinâmico e proteção de stop mínimo por ativo."""

    def test_bitx26_sl_inseguro_bloqueado(self):
        """Validar que BITX26 com SL=8 (abaixo do mín de 250) é bloqueado com mensagem explícita."""
        is_valid, reason, sl, tp = bot.validate_order_stops("BITX26", sl_points=8.0, tp_points=10.0)
        self.assertFalse(is_valid, "BITX26 com SL=8 deveria ter sido bloqueado")
        self.assertIn("BLOQUEADO", reason)
        self.assertIn("Stop abaixo do mínimo seguro", reason)
        self.assertIn("BITX26", reason)

    def test_bitx26_sl_valido_aprovado(self):
        """Validar que BITX26 com SL=250 é aprovado normalmente."""
        is_valid, reason, sl, tp = bot.validate_order_stops("BITX26", sl_points=250.0, tp_points=120.0)
        self.assertTrue(is_valid, f"BITX26 com SL=250 deveria ser válido. Motivo do erro: {reason}")
        self.assertEqual(reason, "")
        self.assertEqual(sl, 250.0)
        self.assertGreaterEqual(tp, 120.0)

    def test_win_sl_inseguro_bloqueado(self):
        """Validar que WIN com SL=20 (abaixo do mín de 50) é bloqueado."""
        is_valid, reason, sl, tp = bot.validate_order_stops("WINZ26", sl_points=20.0, tp_points=100.0)
        self.assertFalse(is_valid, "WINZ26 com SL=20 deveria ter sido bloqueado")
        self.assertIn("BLOQUEADO", reason)
        self.assertIn("Stop abaixo do mínimo seguro", reason)

    def test_win_sl_valido_aprovado(self):
        """Validar que WIN com SL padrão ou seguro é aceito."""
        is_valid, reason, sl, tp = bot.validate_order_stops("WINZ26", sl_points=100.0, tp_points=200.0)
        self.assertTrue(is_valid)
        self.assertEqual(sl, 100.0)
        self.assertEqual(tp, 200.0)

    def test_wdo_sl_inseguro_bloqueado(self):
        """Validar que WDO com SL=1.0 (abaixo do mín de 2.5) é bloqueado."""
        is_valid, reason, sl, tp = bot.validate_order_stops("WDOZ26", sl_points=1.0, tp_points=5.0)
        self.assertFalse(is_valid)
        self.assertIn("BLOQUEADO", reason)


class TestMagicHardCaps(unittest.TestCase):
    """Valida as regras de Hard Cap por magic number."""

    def test_estrutura_magic_26092301(self):
        """Validar se o dicionário MAGIC_HARD_CAPS para 26092301 está configurado e multi-ativo."""
        self.assertIn(26092301, bot.MAGIC_HARD_CAPS, "Magic 26092301 deve estar presente em MAGIC_HARD_CAPS")
        cfg = bot.MAGIC_HARD_CAPS[26092301]
        self.assertTrue(cfg.get("enabled"), "Hard Cap do Magic 26092301 deve estar ativo (enabled=True)")

        # Validação do perfil multi-ativo
        self.assertIn("assets", cfg, "Magic 26092301 deve conter calibração por ativo em 'assets'")
        assets = cfg["assets"]
        self.assertIn("BIT", assets, "BIT deve estar configurado no Hard Cap")
        self.assertIn("WIN", assets, "WIN deve estar configurado no Hard Cap")
        self.assertIn("WDO", assets, "WDO deve estar configurado no Hard Cap")

        self.assertEqual(assets["BIT"]["max_loss_pts"], 100.0, "BIT Hard Cap deve ser 100.0 pts")
        self.assertEqual(assets["WIN"]["max_loss_pts"], 150.0, "WIN Hard Cap deve ser 150.0 pts")
        self.assertEqual(assets["WDO"]["max_loss_pts"], 5.0, "WDO Hard Cap deve ser 5.0 pts")

    @patch.object(bot.mt5, "positions_get")
    @patch.object(bot.mt5, "symbol_info_tick")
    @patch.object(bot.mt5, "order_send")
    def test_check_magic_hard_caps_acionamento(self, mock_order_send, mock_tick, mock_positions):
        """Testar que uma posição do Magic 26092301 com perda além do Hard Cap dispara fechamento a mercado."""
        # Simula posição de compra aberta em WINZ26 a 170.000 pts
        fake_pos = MagicMock()
        fake_pos.ticket = 123456
        fake_pos.magic = 26092301
        fake_pos.symbol = "WINZ26"
        fake_pos.volume = 1.0
        fake_pos.type = 0  # POSITION_TYPE_BUY
        fake_pos.price_open = 170000.0
        mock_positions.return_value = [fake_pos]

        # Simula tick atual a 169.800 pts (perda de 200 pts, maior que o Hard Cap de 150 pts do WIN)
        fake_tick = MagicMock()
        fake_tick.bid = 169800.0
        fake_tick.ask = 169805.0
        mock_tick.return_value = fake_tick

        # Simula retorno bem-sucedido de envio de ordem
        fake_res = MagicMock()
        fake_res.retcode = 10009  # TRADE_RETCODE_DONE
        fake_res.deal = 998877
        mock_order_send.return_value = fake_res

        # Executa a verificação
        closed = bot.check_magic_hard_caps()

        # Deve ter acionado o fechamento
        self.assertEqual(len(closed), 1, "A posição que violou o Hard Cap deveria ter sido encerrada")
        self.assertEqual(closed[0], 123456)


if __name__ == "__main__":
    unittest.main(verbosity=2)
