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
    except Exception:
        pass
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

class SimulationRequest(BaseModel):
    ativo: str = "WINZ26"
    velocidade: int = 10
    data: Optional[str] = None
    num_ticks: int = 25000
    posicao: str = "inicio"

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
    success, message = start_robot(req.ativo)
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
    uvicorn.run(app, host="0.0.0.0", port=8003)

