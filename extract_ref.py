import urllib.request
import re

url = "https://raw.githubusercontent.com/Mac101068/Marcos-Adriano-de-Camargo/main/src/utils/pythonScriptGenerator.ts"
content = urllib.request.urlopen(url).read().decode('utf-8')

# The file contains: return `"""..."""`;
# We can extract from return ` to `; at the end
start_idx = content.find("return `")
end_idx = content.rfind("`;")

if start_idx != -1 and end_idx != -1:
    template = content[start_idx + len("return `"):end_idx]
    # Replace typescript template expressions like ${config.symbol} with default values
    replacements = {
        "${config.symbol}": "WIN$",
        "${config.accountMode}": "HEDGING",
        "${config.magicNumber}": "101068",
        "${config.contracts}": "1",
        "${config.pyramidMaxContracts}": "5",
        "${config.boxPoints}": "50",
        "${config.trailingStopPoints}": "30",
        "${config.trailingTriggerPoints}": "40",
        "${config.tradingStartTime}": "09:05",
        "${config.tradingEndTime}": "17:40",
        "${config.emergencyCloseTime}": "17:50",
        "${config.wsPort}": "8765",
        "${config.minAggressionDelta}": "150",
        "${config.enableConvergenceFilter ? 'True' : 'False'}": "True",
        "${config.enablePullbackRetest ? 'True' : 'False'}": "True",
        "${config.pullbackRetestTolerance}": "10",
        "${config.pullbackMaxWaitBars}": "2",
        "${isPyramidMode ? 'PYRAMID_FLOW_CONFLUENCE' : 'PULLBACK_RETEST'}": "PYRAMID_FLOW_CONFLUENCE",
        "${isPyramidMode ? 'PIRÂMIDE & CONFLUÊNCIA DE FLUXO RENKO 10R (TP 50p + SURFE)' : 'RENKO 10R COM ENTRADA NO RETESTE / PULLBACK'}": "PIRÂMIDE & CONFLUÊNCIA DE FLUXO RENKO 10R",
        "${isPyramidMode ? 'PIRÂMIDE EM CADA BOX VERDE/VERMELHO (TP 50p) + ORDEM MÃE ABERTA ATÉ INVERSÃO' : 'PULLBACK / RETESTE DA ABERTURA DO BOX'}": "PIRÂMIDE EM CADA BOX",
    }
    for k, v in replacements.items():
        template = template.replace(k, v)

    # Also clean up any other ${...} if any
    template = re.sub(r'\$\{.*?\}', 'True', template)

    with open("github_reference_robot.py", "w", encoding="utf-8") as f:
        f.write(template)
    print("Salvo com sucesso! Total de caracteres:", len(template))
else:
    print("Tags de template não encontradas!")
