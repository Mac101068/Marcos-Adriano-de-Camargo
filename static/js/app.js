// ═══════════════════════════════════════════════════════════════
// RoboFluxoB3 Dashboard v2.0 — Advanced Trading UI
// Range Bars (Lightweight Charts) + Footprint Chart (Canvas)
// ═══════════════════════════════════════════════════════════════

console.log("RoboFluxoB3 Dashboard v2.0 loaded");

let lastLogCount = 0;
let autoScrollLogs = true;

// ─── CHART STATE ───
let rangeChart = null;
let candlestickSeries = null;
let volumeSeries = null;
let markerSeries = null;
let chartInitialized = false;
let lastOhlcLength = 0;
let selectedBarId = null;
let currentFootprint = {};
let currentOhlc = [];

// ─── COLORS ───
const COLORS = {
    green: '#00e676',
    greenDim: '#00c85380',
    red: '#ff1744',
    redDim: '#d5000080',
    blue: '#448aff',
    cyan: '#18ffff',
    bgVoid: '#05060a',
    bgPrimary: '#0a0d14',
    bgSecondary: '#0f1219',
    bgTertiary: '#151923',
    textPrimary: '#e8eaed',
    textSecondary: '#8b8fa3',
    textMuted: '#5a5e72',
    borderDefault: 'rgba(255, 255, 255, 0.07)',
};

// ═══════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════
function updateClock() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleTimeString('pt-BR');
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconMap = { success: 'bi-check-circle-fill', error: 'bi-exclamation-circle-fill', info: 'bi-info-circle-fill' };
    const colorMap = { success: COLORS.green, error: COLORS.red, info: COLORS.blue };
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
            <i class="bi ${iconMap[type]}" style="color: ${colorMap[type]}; font-size: 0.875rem;"></i>
            <span style="font-size: 0.8125rem; font-weight: 500;">${message}</span>
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════
// RANGE BARS CHART (Lightweight Charts)
// ═══════════════════════════════════════════════════════════════
function initRangeChart() {
    if (chartInitialized) return;

    const container = document.getElementById('range-chart-container');
    const emptyState = document.getElementById('range-chart-empty');
    if (emptyState) emptyState.style.display = 'none';

    rangeChart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 310,
        layout: {
            background: { type: 'solid', color: COLORS.bgPrimary },
            textColor: COLORS.textSecondary,
            fontFamily: "'JetBrains Mono', 'Inter', sans-serif",
            fontSize: 10,
        },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: 'rgba(24, 255, 255, 0.15)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: COLORS.bgTertiary,
            },
            horzLine: {
                color: 'rgba(24, 255, 255, 0.15)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: COLORS.bgTertiary,
            },
        },
        rightPriceScale: {
            borderColor: COLORS.borderDefault,
            scaleMargins: { top: 0.1, bottom: 0.2 },
        },
        timeScale: {
            borderColor: COLORS.borderDefault,
            timeVisible: false,
            secondsVisible: false,
            tickMarkFormatter: (time) => `#${time}`,
        },
        handleScroll: { vertTouchDrag: false },
    });

    candlestickSeries = rangeChart.addCandlestickSeries({
        upColor: COLORS.green,
        downColor: COLORS.red,
        borderUpColor: COLORS.green,
        borderDownColor: COLORS.red,
        wickUpColor: COLORS.green,
        wickDownColor: COLORS.red,
    });

    volumeSeries = rangeChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
    });

    rangeChart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
    });

    // Click on chart to select a bar for footprint
    rangeChart.subscribeCrosshairMove((param) => {
        if (!param.time) return;
        const barId = param.time;
        if (barId !== selectedBarId) {
            selectedBarId = barId;
            renderFootprintForBar(barId);
        }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            rangeChart.applyOptions({
                width: entry.contentRect.width,
            });
        }
    });
    resizeObserver.observe(container);

    chartInitialized = true;
}

function updateRangeChart(ohlcData) {
    if (!ohlcData || ohlcData.length === 0) return;

    if (!chartInitialized) {
        initRangeChart();
    }

    // Transform data: use bar_id as time (it's sequential, works as index)
    const candles = ohlcData.map(bar => ({
        time: bar.bar_id,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
    }));

    const volumes = ohlcData.map(bar => ({
        time: bar.bar_id,
        value: bar.volume,
        color: bar.close >= bar.open
            ? 'rgba(0, 230, 118, 0.25)'
            : 'rgba(255, 23, 68, 0.25)',
    }));

    candlestickSeries.setData(candles);
    volumeSeries.setData(volumes);

    // Update bar count badge
    document.getElementById('chart-bar-count').textContent = `${candles.length} BARRAS`;

    // Auto-scroll to latest bar if new bars arrived
    if (ohlcData.length !== lastOhlcLength) {
        rangeChart.timeScale().scrollToRealTime();
        lastOhlcLength = ohlcData.length;
    }
}

// ═══════════════════════════════════════════════════════════════
// FOOTPRINT CHART (Custom Canvas Rendering)
// ═══════════════════════════════════════════════════════════════

function renderFootprintForBar(barId) {
    const fpData = currentFootprint[String(barId)];
    const barInfo = currentOhlc.find(b => b.bar_id === barId);

    const label = document.getElementById('fp-selected-bar');
    const emptyState = document.getElementById('footprint-empty');
    const canvas = document.getElementById('footprint-canvas');
    const container = document.getElementById('footprint-container');

    if (!fpData || fpData.length === 0) {
        label.textContent = 'Selecione uma barra';
        if (emptyState) emptyState.style.display = 'flex';
        canvas.style.display = 'none';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    canvas.style.display = 'block';

    const barLabel = barInfo
        ? `Barra #${barId} | O: ${barInfo.open.toFixed(0)} H: ${barInfo.high.toFixed(0)} L: ${barInfo.low.toFixed(0)} C: ${barInfo.close.toFixed(0)}`
        : `Barra #${barId}`;
    label.textContent = barLabel;

    // Sort by price descending (topo -> fundo)
    const sorted = [...fpData].sort((a, b) => b.price - a.price);

    drawFootprintCanvas(canvas, container, sorted, barInfo);
}

function drawFootprintCanvas(canvas, container, levels, barInfo) {
    const dpr = window.devicePixelRatio || 1;
    const rowHeight = 22;
    const headerHeight = 24;
    const paddingLeft = 75;
    const paddingRight = 16;
    const containerWidth = container.clientWidth;
    const canvasHeight = Math.max(headerHeight + levels.length * rowHeight + 6, 160);

    canvas.width = containerWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = canvasHeight + 'px';

    // Ajustar container para caber
    container.style.height = Math.min(canvasHeight, 310) + 'px';
    container.style.overflow = canvasHeight > 310 ? 'auto' : 'hidden';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = COLORS.bgPrimary;
    ctx.fillRect(0, 0, containerWidth, canvasHeight);

    // Find max volume for scaling bars
    let maxVol = 0;
    for (const level of levels) {
        maxVol = Math.max(maxVol, level.buy_vol, level.sell_vol);
    }
    if (maxVol === 0) maxVol = 1;

    const barAreaWidth = (containerWidth - paddingLeft - paddingRight) / 2;
    const centerX = paddingLeft + barAreaWidth;

    // Header
    ctx.fillStyle = COLORS.bgTertiary;
    ctx.fillRect(0, 0, containerWidth, headerHeight);

    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = 'center';
    ctx.fillText('SELL VOL', paddingLeft + barAreaWidth / 2, headerHeight / 2 + 3);
    ctx.fillText('BUY VOL', centerX + barAreaWidth / 2, headerHeight / 2 + 3);

    ctx.textAlign = 'left';
    ctx.fillText('PREÇO', 6, headerHeight / 2 + 3);

    // Draw bottom header line
    ctx.strokeStyle = COLORS.borderDefault;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(containerWidth, headerHeight);
    ctx.stroke();

    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(centerX, headerHeight);
    ctx.lineTo(centerX, canvasHeight);
    ctx.stroke();

    // Draw rows
    for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        const y = headerHeight + i * rowHeight;

        // Alternate row background
        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
            ctx.fillRect(0, y, containerWidth, rowHeight);
        }

        // Highlight high/low prices
        let isHigh = barInfo && level.price === barInfo.high;
        let isLow = barInfo && level.price === barInfo.low;

        if (isHigh) {
            ctx.fillStyle = 'rgba(255, 23, 68, 0.06)';
            ctx.fillRect(0, y, containerWidth, rowHeight);
        } else if (isLow) {
            ctx.fillStyle = 'rgba(0, 230, 118, 0.06)';
            ctx.fillRect(0, y, containerWidth, rowHeight);
        }

        // Price label
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';

        if (isHigh) {
            ctx.fillStyle = COLORS.red;
        } else if (isLow) {
            ctx.fillStyle = COLORS.green;
        } else {
            ctx.fillStyle = COLORS.textSecondary;
        }
        ctx.fillText(level.price.toFixed(0), paddingLeft - 8, y + rowHeight / 2 + 3);

        // Sell volume bar (goes LEFT from center)
        const sellWidth = (level.sell_vol / maxVol) * (barAreaWidth - 14);
        if (sellWidth > 0) {
            const sellX = centerX - sellWidth - 3;
            const barY = y + 3;
            const barH = rowHeight - 6;

            // Bar
            const sellGrd = ctx.createLinearGradient(sellX, 0, centerX - 3, 0);
            sellGrd.addColorStop(0, 'rgba(255, 23, 68, 0.15)');
            sellGrd.addColorStop(1, 'rgba(255, 23, 68, 0.45)');
            ctx.fillStyle = sellGrd;
            roundRect(ctx, sellX, barY, sellWidth, barH, 2);

            // Volume text
            ctx.font = '700 8.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillStyle = COLORS.red;
            ctx.fillText(formatVolume(level.sell_vol), centerX - sellWidth - 6, y + rowHeight / 2 + 3);
        }

        // Buy volume bar (goes RIGHT from center)
        const buyWidth = (level.buy_vol / maxVol) * (barAreaWidth - 14);
        if (buyWidth > 0) {
            const buyX = centerX + 3;
            const barY = y + 3;
            const barH = rowHeight - 6;

            // Bar
            const buyGrd = ctx.createLinearGradient(buyX, 0, buyX + buyWidth, 0);
            buyGrd.addColorStop(0, 'rgba(0, 230, 118, 0.45)');
            buyGrd.addColorStop(1, 'rgba(0, 230, 118, 0.15)');
            ctx.fillStyle = buyGrd;
            roundRect(ctx, buyX, barY, buyWidth, barH, 2);

            // Volume text
            ctx.font = '700 8.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillStyle = COLORS.green;
            ctx.fillText(formatVolume(level.buy_vol), buyX + buyWidth + 4, y + rowHeight / 2 + 3);
        }

        // Delta indicator (small bar at the right edge)
        const delta = level.delta;
        if (delta !== 0) {
            const deltaColor = delta > 0 ? COLORS.green : COLORS.red;
            ctx.fillStyle = deltaColor;
            ctx.globalAlpha = 0.35;
            ctx.fillRect(containerWidth - 4, y + 2, 3, rowHeight - 4);
            ctx.globalAlpha = 1.0;
        }

        // Row separator
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.beginPath();
        ctx.moveTo(0, y + rowHeight);
        ctx.lineTo(containerWidth, y + rowHeight);
        ctx.stroke();
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

function formatVolume(vol) {
    if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
    if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
    return Math.round(vol).toString();
}

// ═══════════════════════════════════════════════════════════════
// CHART DATA FETCH
// ═══════════════════════════════════════════════════════════════
function fetchChartData() {
    fetch('/api/chart_data')
        .then(res => res.json())
        .then(data => {
            currentOhlc = data.ohlc || [];
            currentFootprint = data.footprint || {};

            if (currentOhlc.length > 0) {
                updateRangeChart(currentOhlc);

                // Auto-select last bar if none selected
                if (selectedBarId === null && currentOhlc.length > 0) {
                    selectedBarId = currentOhlc[currentOhlc.length - 1].bar_id;
                    renderFootprintForBar(selectedBarId);
                } else if (selectedBarId !== null) {
                    // Refresh the current footprint view
                    renderFootprintForBar(selectedBarId);
                }
            }
        })
        .catch(err => {
            // Silently ignore chart data fetch errors
        });
}

// ═══════════════════════════════════════════════════════════════
// STATUS UPDATE
// ═══════════════════════════════════════════════════════════════
function updateStatus() {
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            // Badges
            const badgeRobot = document.getElementById('badge-robot');
            const badgeRobotText = document.getElementById('badge-robot-text');
            const badgeMt5 = document.getElementById('badge-mt5');
            const badgeMt5Text = document.getElementById('badge-mt5-text');
            const badgeMode = document.getElementById('badge-mode');
            const badgeModeText = document.getElementById('badge-mode-text');
            const btnConnect = document.getElementById('btn-connect');

            // MT5 Connection
            if (data.mt5_connected) {
                badgeMt5.className = 'badge mt5-ok';
                badgeMt5Text.textContent = 'MT5: CONECTADO';
                btnConnect.disabled = true;
                btnConnect.innerHTML = '<i class="bi bi-check-circle"></i> CONECTADO';
            } else {
                badgeMt5.className = 'badge mt5-err';
                badgeMt5Text.textContent = 'MT5: DESCONECTADO';
                if (!btnConnect.innerHTML.includes('CONECTANDO')) {
                    btnConnect.disabled = false;
                    btnConnect.innerHTML = '<i class="bi bi-plug"></i> CONECTAR MT5';
                }
            }

            // Mode & Running State
            const btnStart = document.getElementById('btn-start');
            const btnStop = document.getElementById('btn-stop');
            const btnStartSim = document.getElementById('btn-start-sim');
            const btnStopSim = document.getElementById('btn-stop-sim');
            const simProgressBox = document.getElementById('sim-progress-box');

            if (data.simulation_mode) {
                badgeMode.className = 'badge badge-sim-active';
                badgeModeText.textContent = `SIMULAÇÃO (${data.simulation_speed}x)`;
                badgeRobot.className = 'badge active';
                badgeRobotText.textContent = 'SIMULADOR: ATIVO';

                btnStart.disabled = true;
                btnStop.disabled = false;
                btnStartSim.disabled = true;
                btnStopSim.disabled = false;

                // Update Progress Box
                simProgressBox.style.display = 'flex';
                const pct = data.simulation_progress || 0;
                document.getElementById('sim-pct').textContent = `${pct}%`;
                document.getElementById('sim-fill').style.width = `${pct}%`;
                document.getElementById('sim-ticks-count').textContent =
                    `${(data.simulation_processed_ticks || 0).toLocaleString('pt-BR')} / ${(data.simulation_total_ticks || 0).toLocaleString('pt-BR')}`;
                document.getElementById('sim-tick-clock').textContent = data.simulation_current_tick_time || '--:--:--';
                document.getElementById('sim-date-val').textContent = data.simulation_date || '-';
                document.getElementById('sim-speed-val').textContent = `${data.simulation_speed || 10}x`;

            } else {
                // Fora de simulação: o botão de iniciar simulação está sempre disponível
                btnStartSim.disabled = false;
                btnStopSim.disabled = !data.running;

                if (data.running) {
                    badgeMode.className = 'badge';
                    badgeModeText.textContent = 'MODO: TEMPO REAL';
                    badgeRobot.className = 'badge active';
                    badgeRobotText.textContent = 'ROBOT: ONLINE';

                    btnStart.disabled = true;
                    btnStop.disabled = false;
                    simProgressBox.style.display = 'none';

                } else {
                    badgeMode.className = 'badge';
                    badgeModeText.textContent = 'MODO: STANDBY';
                    badgeRobot.className = 'badge inactive';
                    badgeRobotText.textContent = 'ROBOT: OFFLINE';

                    btnStart.disabled = false;
                    btnStop.disabled = true;

                    if (data.simulation_progress >= 100) {
                        simProgressBox.style.display = 'flex';
                        document.getElementById('sim-pct').textContent = '100% (Concluído)';
                        document.getElementById('sim-fill').style.width = '100%';
                    }
                }
            }

            // Metrics
            document.getElementById('metric-signals').textContent = data.signals_count || 0;
            document.getElementById('metric-orders').textContent = data.orders_count || 0;
            const qEl = document.getElementById('metric-queue');
            if (qEl) qEl.textContent = data.queue_size || 0;

            // P&L e Estatísticas Renko / Simulação
            if (data.sim_resultado) {
                const res = data.sim_resultado;
                const pts = res.pts || 0;
                const reais = res.reais || (pts * 0.20);
                const pnlEl = document.getElementById('metric-pnl');
                const pnlReaisEl = document.getElementById('metric-pnl-reais');
                if (pnlEl) {
                    pnlEl.textContent = (pts > 0 ? '+' : '') + Math.round(pts) + ' pts';
                    pnlEl.style.color = pts >= 0 ? 'var(--green)' : 'var(--red)';
                }
                if (pnlReaisEl) {
                    pnlReaisEl.textContent = 'P&L: ' + (reais >= 0 ? '+' : '') + reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    pnlReaisEl.style.color = reais >= 0 ? 'var(--green)' : 'var(--red)';
                }
                const winrateEl = document.getElementById('metric-winrate');
                const ddEl = document.getElementById('metric-drawdown');
                if (winrateEl) {
                    winrateEl.textContent = (res.acerto || 0).toFixed(1) + '%';
                }
                if (ddEl) {
                    ddEl.textContent = `Acerto | DD ${Math.round(res.max_dd_pts || 0)}p`;
                }
            }


            // Account
            if (data.account_info) {
                document.getElementById('info-login').textContent = data.account_info.login || '-';
                document.getElementById('info-server').textContent = data.account_info.server || '-';
                document.getElementById('info-balance').textContent =
                    'R$ ' + (data.account_info.balance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                document.getElementById('info-equity').textContent =
                    'R$ ' + (data.account_info.equity || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

                const modeMap = { 0: 'DEMO', 1: 'CONTEST', 2: 'REAL' };
                document.getElementById('metric-account-mode').textContent =
                    modeMap[data.account_info.trade_mode] || 'N/A';

                document.getElementById('metric-balance').textContent =
                    'R$ ' + (data.account_info.balance || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
            }

            // Signals Table
            const signalsBody = document.getElementById('signals-table-body');
            const lastSignals = data.last_signals || [];

            if (lastSignals.length === 0) {
                signalsBody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem;">
                            <i class="bi bi-lightning" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.3;"></i>
                            Aguardando sinais...
                        </td>
                    </tr>
                `;
            } else {
                signalsBody.innerHTML = lastSignals.slice().reverse().map(signal => `
                    <tr>
                        <td>${signal.time}</td>
                        <td class="signal-type">${signal.tipo}</td>
                        <td><span class="badge-direction ${signal.direcao === 'COMPRA' ? 'badge-compra' : 'badge-venda'}">${signal.direcao}</span></td>
                        <td style="font-weight: 700;">${signal.preco}</td>
                    </tr>
                `).join('');
            }

            // Logs
            const logsContent = document.getElementById('logs-content');
            const logsContainer = document.getElementById('logs-container');
            const logs = data.logs || [];

            if (logs.length !== lastLogCount) {
                logsContent.innerHTML = logs.map(log =>
                    `<div class="log-entry">&gt; ${log}</div>`
                ).join('');
                lastLogCount = logs.length;

                if (autoScrollLogs) {
                    logsContainer.scrollTop = logsContainer.scrollHeight;
                }
            }
        })
        .catch(err => {
            console.error('Erro ao atualizar status:', err);
        });
}

// ═══════════════════════════════════════════════════════════════
// SPEED PILLS & SIMULATION STATE
// ═══════════════════════════════════════════════════════════════
let selectedSpeed = 10;

document.querySelectorAll('.speed-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.speed-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selectedSpeed = parseInt(pill.dataset.speed, 10);
    });
});

// Mode switcher tabs (Live vs Sim)
const tabLive = document.getElementById('tab-btn-live');
const tabSim = document.getElementById('tab-btn-sim');
const panelLive = document.getElementById('panel-live');
const panelSim = document.getElementById('panel-sim');

tabLive.addEventListener('click', () => {
    tabLive.classList.add('active');
    tabLive.classList.remove('sim-active');
    tabSim.classList.remove('active', 'sim-active');
    panelLive.style.display = 'block';
    panelSim.style.display = 'none';
});

tabSim.addEventListener('click', () => {
    tabSim.classList.add('active', 'sim-active');
    tabLive.classList.remove('active');
    panelLive.style.display = 'none';
    panelSim.style.display = 'block';
});

// Date selector custom toggle
const selectSimDate = document.getElementById('select-sim-date');
const groupCustomDate = document.getElementById('group-sim-custom-date');
selectSimDate.addEventListener('change', () => {
    if (selectSimDate.value === 'custom') {
        groupCustomDate.style.display = 'block';
    } else {
        groupCustomDate.style.display = 'none';
    }
});

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS — LIVE & MT5
// ═══════════════════════════════════════════════════════════════
document.getElementById('btn-connect').addEventListener('click', () => {
    const btnConnect = document.getElementById('btn-connect');
    btnConnect.disabled = true;
    btnConnect.innerHTML = '<i class="bi bi-arrow-clockwise"></i> CONECTANDO...';

    fetch('/api/connect', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
        })
        .catch(err => {
            showToast('Erro ao conectar ao MT5', 'error');
            console.error(err);
        })
        .finally(() => {
            setTimeout(updateStatus, 250);
        });
});

document.getElementById('btn-start').addEventListener('click', () => {
    const ativo = document.getElementById('input-ativo').value.trim().toUpperCase();
    if (!ativo) {
        showToast('Informe um ativo válido', 'error');
        return;
    }

    fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: ativo })
    })
        .then(response => response.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
            updateStatus();
        })
        .catch(err => {
            showToast('Erro ao iniciar robô', 'error');
            console.error(err);
        });
});

document.getElementById('btn-stop').addEventListener('click', () => {
    fetch('/api/stop', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
            updateStatus();
        })
        .catch(err => {
            showToast('Erro ao parar robô', 'error');
            console.error(err);
        });
});

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS — SIMULAÇÃO / REPLAY MT5 & CSV
// ═══════════════════════════════════════════════════════════════
document.getElementById('btn-start-sim').addEventListener('click', () => {
    const ativo = document.getElementById('input-sim-ativo').value.trim().toUpperCase() || 'WINZ26';
    const numTicks = parseInt(document.getElementById('select-sim-ticks').value, 10) || 25000;
    const posicao = document.getElementById('select-sim-pos').value || 'inicio';

    let dataStr = null;
    const dateVal = selectSimDate.value;
    if (dateVal === 'custom') {
        dataStr = document.getElementById('input-sim-custom-date').value || null;
    } else if (dateVal !== 'auto') {
        dataStr = dateVal;
    }

    const btnSim = document.getElementById('btn-start-sim');
    btnSim.disabled = true;
    btnSim.innerHTML = '<i class="bi bi-arrow-clockwise"></i> CARREGANDO TICKS...';

    fetch('/api/simulation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ativo: ativo,
            velocidade: selectedSpeed,
            data: dataStr,
            num_ticks: numTicks,
            posicao: posicao
        })
    })
        .then(response => response.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
            updateStatus();
        })
        .catch(err => {
            showToast('Erro ao iniciar simulação', 'error');
            console.error(err);
        })
        .finally(() => {
            btnSim.innerHTML = '<i class="bi bi-play-circle-fill"></i> INICIAR SIMULAÇÃO';
        });
});

document.getElementById('btn-stop-sim').addEventListener('click', () => {
    fetch('/api/simulation/stop', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
            updateStatus();
        })
        .catch(err => {
            showToast('Erro ao parar simulação', 'error');
            console.error(err);
        });
});

// CSV Dropzone & File Upload
const csvDropzone = document.getElementById('csv-dropzone');
const inputCsvFile = document.getElementById('input-csv-file');
const csvLabel = document.getElementById('csv-upload-label');

csvDropzone.addEventListener('click', () => {
    inputCsvFile.click();
});

inputCsvFile.addEventListener('change', () => {
    if (!inputCsvFile.files || inputCsvFile.files.length === 0) return;
    const file = inputCsvFile.files[0];
    const ativo = document.getElementById('input-sim-ativo').value.trim().toUpperCase() || 'WINZ26';

    csvLabel.textContent = `Enviando ${file.name}...`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('ativo', ativo);
    formData.append('velocidade', selectedSpeed);

    fetch('/api/simulation/upload', {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
            if (data.success) {
                csvLabel.textContent = `Carregado: ${file.name}`;
            } else {
                csvLabel.textContent = 'Importar CSV do MetaTrader';
            }
            updateStatus();
        })
        .catch(err => {
            showToast('Erro ao processar CSV de ticks', 'error');
            csvLabel.textContent = 'Importar CSV do MetaTrader';
            console.error(err);
        });
});

// Logs & Controls
document.getElementById('btn-clear-logs').addEventListener('click', () => {
    document.getElementById('logs-content').innerHTML =
        '<div style="color: var(--text-muted);">View limpa pelo usuário...</div>';
    showToast('Logs limpos', 'info');
});

document.getElementById('logs-container').addEventListener('scroll', () => {
    const container = document.getElementById('logs-container');
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    autoScrollLogs = isAtBottom;
});

// Handle window resize for footprint canvas
window.addEventListener('resize', () => {
    if (selectedBarId !== null) {
        renderFootprintForBar(selectedBarId);
    }
});

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION & DYNAMIC POLLING
// ═══════════════════════════════════════════════════════════════
setInterval(updateClock, 1000);
setInterval(updateStatus, 800);

// Dynamic chart data polling: faster when simulation is active
setInterval(() => {
    fetchChartData();
}, 1000);

updateClock();
updateStatus();
fetchChartData();
showToast('Dashboard carregado com sucesso', 'success');

// Auto-conecta ao MT5 aberto na máquina local para puxar o mercado ao vivo de hoje
fetch('/api/connect', { method: 'POST' })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showToast('Conectado automaticamente ao MetaTrader 5 (XP)', 'success');
            updateStatus();
            fetchChartData();
        }
    })
    .catch(() => {});


