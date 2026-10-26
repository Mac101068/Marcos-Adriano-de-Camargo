from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from jinja2 import Environment, FileSystemLoader
from web_app import (
    start_robot, stop_robot, get_status, get_chart_data, validar_e_conectar,
    start_simulation, start_simulation_from_df, carregar_ticks_csv_bytes
)
import os

from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        validar_e_conectar()
        start_robot("WINZ26")
        print("✅ [LOCALHOST:8000] MetaTrader 5 conectado e captura de ticks ao vivo iniciada para WINZ26!")
    except Exception as e:
        print(f"Aviso no auto-start de ticks: {e}")
    yield

app = FastAPI(title="RoboFluxoB3", description="Painel de Controle do Robo de Trading B3", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")

env = Environment(loader=FileSystemLoader("templates"))

class StartRequest(BaseModel):
    ativo: str = "WINZ26"
    renko_r: Optional[int] = 10
    box_points: Optional[int] = None

class RenkoConfigRequest(BaseModel):
    renko_r: Optional[int] = None
    box_points: Optional[int] = None

class SimulationRequest(BaseModel):
    ativo: str = "WINZ26"
    velocidade: int = 10
    data: Optional[str] = None
    num_ticks: int = 25000
    posicao: str = "inicio"
    renko_r: Optional[int] = 10

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    try:
        template = env.get_template("index.html")
        content = template.render(request=request)
        return HTMLResponse(content=content)
    except Exception as e:
        return HTMLResponse(content=f"<h1>Erro</h1><pre>{e}</pre>", status_code=500)

@app.get("/api/status")
async def status():
    return JSONResponse(content=get_status())

@app.get("/api/renko/config")
async def get_renko_config():
    import json
    config_path = os.path.join(os.path.dirname(__file__), "renko_config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return JSONResponse(content=json.load(f))
        except Exception:
            pass
    from web_app import state
    return JSONResponse(content={
        "renko_r": getattr(state, "renko_r", 20),
        "box_points": getattr(state, "renko_box_pts", 100),
        "min_delta_threshold": 50,
        "min_reversal_delta": 75,
        "pyramid_tp_points": 100
    })

@app.post("/api/renko/config")
async def renko_config(req: RenkoConfigRequest):
    import json
    from datetime import datetime
    from web_app import state
    if req.box_points is not None:
        pts = int(req.box_points)
        r = max(1, pts // 5)
    elif req.renko_r is not None:
        r = int(req.renko_r)
        pts = r * 5
    else:
        return JSONResponse(content={"success": False, "message": "Parâmetro inválido"})

    state.renko_r = r
    state.renko_box_pts = pts
    if state.renko_engine:
        state.renko_engine.box_points = pts
    state.log(f"Parâmetro Renko ajustado para {r}R ({pts} pontos)")

    # Salva em renko_config.json para persistência e sincronização com o bot
    cfg = {
        "renko_r": r,
        "box_points": pts,
        "min_delta_threshold": 50,
        "min_reversal_delta": 75,
        "pyramid_tp_points": pts,
        "last_updated": datetime.now().isoformat()
    }
    config_path = os.path.join(os.path.dirname(__file__), "renko_config.json")
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"Erro ao salvar renko_config.json: {e}")

    return JSONResponse(content={
        "success": True,
        "message": f"Renko ajustado com sucesso para {r}R ({pts} pontos) e salvo na estratégia!",
        "renko_r": r,
        "box_points": pts
    })

@app.get("/api/deals/today")
async def get_deals_today():
    import MetaTrader5 as mt5
    from datetime import datetime
    try:
        if not mt5.initialize():
            return JSONResponse(content={"success": False, "message": "MT5 não inicializado", "deals": [], "summary": {}})
        
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        deals = mt5.history_deals_get(today_start, datetime.now())
        if deals is None or len(deals) == 0:
            return JSONResponse(content={"success": True, "deals": [], "summary": {
                "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0, "net_profit": 0,
                "gross_profit": 0, "gross_loss": 0, "profit_factor": 0
            }})

        deals_list = []
        gross_profit = 0.0
        gross_loss = 0.0
        wins = 0
        losses = 0

        # Calcula o offset de fuso horário entre o relógio local (Brasília) e o servidor da corretora MT5
        now_local = datetime.now()
        ref_tick = mt5.symbol_info_tick("WINZ26")
        if ref_tick and ref_tick.time > 0:
            offset_seconds = round((now_local.timestamp() - ref_tick.time) / 3600.0) * 3600
        else:
            offset_seconds = 3 * 3600  # Default 3 horas

        # Filtra saídas (entry == 1 ou entry == 2)
        for d in reversed(deals):
            if d.entry in [1, 2]:  # Saída ou Inversão
                profit = float(d.profit)
                if profit > 0:
                    gross_profit += profit
                    wins += 1
                elif profit < 0:
                    gross_loss += abs(profit)
                    losses += 1

                # Formata comentário
                comm = d.comment or ""
                if comm.startswith("[tp"):
                    tag = "PIRÂMIDE TP"
                elif comm.startswith("[sl"):
                    tag = "STOP LOSS"
                elif "Inversao" in comm or "Zeragem" in comm:
                    tag = "INVERSÃO FLUXO"
                else:
                    tag = comm or "ORDEM MT5"

                tipo_str = "COMPRA" if d.type == 0 else ("VENDA" if d.type == 1 else "SAÍDA")
                pts = (profit / (0.20 * d.volume)) if d.volume > 0 else 0

                deal_local_time = datetime.fromtimestamp(d.time + offset_seconds).strftime("%H:%M:%S")

                deals_list.append({
                    "ticket": d.ticket,
                    "order": d.order,
                    "position_id": d.position_id,
                    "time": deal_local_time,
                    "symbol": d.symbol,
                    "type": tipo_str,
                    "volume": int(d.volume),
                    "price": float(d.price),
                    "profit": round(profit, 2),
                    "points": round(pts, 0),
                    "comment": tag,
                    "is_win": profit > 0
                })

        total_trades = wins + losses
        win_rate = round((wins / total_trades * 100), 1) if total_trades > 0 else 0
        pf = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (99.0 if gross_profit > 0 else 0)
        net = round(gross_profit - gross_loss, 2)

        summary = {
            "total_trades": total_trades,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "net_profit": net,
            "gross_profit": round(gross_profit, 2),
            "gross_loss": round(gross_loss, 2),
            "profit_factor": pf
        }

        # Retorna as últimas 100 operações ordenadas da mais nova para a mais antiga
        return JSONResponse(content={
            "success": True,
            "deals": deals_list[:100],
            "summary": summary
        })
    except Exception as e:
        return JSONResponse(content={"success": False, "error": str(e), "deals": [], "summary": {}})


@app.get("/api/initial_data")
async def get_initial_data():
    import json
    data_path = os.path.join(os.path.dirname(__file__), "initialData.json")
    if not os.path.exists(data_path):
        data_path = os.path.join(os.path.dirname(__file__), "interface_github", "src", "data", "initialData.json")
    if os.path.exists(data_path):
        with open(data_path, "r", encoding="utf-8") as f:
            return JSONResponse(content=json.load(f))
    return JSONResponse(content={"error": "initialData.json nao encontrado"}, status_code=404)

@app.post("/api/connect")
async def connect():
    success = validar_e_conectar()
    st = get_status()
    if success:
        return JSONResponse(content={"success": True, "message": "Conectado ao MT5 com sucesso", "status": st})
    else:
        from web_app import state
        msg = state.error or "Falha ao conectar ao MT5"
        return JSONResponse(content={"success": False, "message": msg, "status": st})

@app.post("/api/start")
async def start(req: StartRequest):
    success, message = start_robot(req.ativo, renko_r=req.renko_r, box_points=req.box_points)
    return JSONResponse(content={"success": success, "message": message})

@app.post("/api/stop")
async def stop():
    success, message = stop_robot()
    return JSONResponse(content={"success": success, "message": message})

@app.post("/api/simulation/start")
async def simulation_start(req: SimulationRequest):
    success, message = start_simulation(
        ativo=req.ativo,
        velocidade=req.velocidade,
        data=req.data,
        num_ticks=req.num_ticks,
        posicao=req.posicao
    )
    return JSONResponse(content={"success": success, "message": message})

@app.post("/api/simulation/stop")
async def simulation_stop():
    success, message = stop_robot()
    return JSONResponse(content={"success": success, "message": message})

@app.post("/api/simulation/upload")
async def simulation_upload(
    file: UploadFile = File(...),
    ativo: str = Form("WINZ26"),
    velocidade: int = Form(10)
):
    try:
        file_bytes = await file.read()
        df = carregar_ticks_csv_bytes(file_bytes)
        if df is None or len(df) == 0:
            return JSONResponse(content={"success": False, "message": "Nenhum tick válido encontrado no arquivo CSV."})
        success, message = start_simulation_from_df(
            ticks_df=df,
            ativo=ativo,
            velocidade=velocidade,
            nome_fonte=file.filename or "Upload CSV"
        )
        return JSONResponse(content={"success": success, "message": message})
    except Exception as e:
        return JSONResponse(content={"success": False, "message": f"Erro ao processar CSV: {e}"})

@app.get("/api/chart_data")
async def chart_data():
    return JSONResponse(content=get_chart_data())

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

