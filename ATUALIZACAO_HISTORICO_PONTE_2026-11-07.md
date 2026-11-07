# Atualização do histórico da ponte — 07/11/2026

## Objetivo

Corrigir a exibição do pregão mais recente no gráfico ao conectar a ponte com o MetaTrader 5,
preservando o token de autenticação já salvo no app.

## Alterações

- O app solicita até 10 dias de histórico após autenticar a ponte e carrega no gráfico os ticks do
  pregão mais recente retornado pelo MT5.
- O script gerado usa o campo `last` dos ticks históricos como preço, conforme o formato retornado
  pelo MT5.
- O histórico é aplicado apenas à visualização: não passa pelo fluxo de ordens nem gera operações.
- Se houver ticks ao vivo posteriores do mesmo pregão, eles são mantidos junto ao histórico.
- O teste do script verifica o uso de `last` e a preservação do token já armazenado.

## Atualizar a ponte no Windows

1. No app atualizado, abra **Ajustes → Segurança da Ponte** e baixe novamente
   `bot_mt5_convergencia_10r.py`.
2. No Windows, pressione `Ctrl+C` no terminal em que a ponte está rodando.
3. Substitua o arquivo antigo pelo script recém-baixado.
4. Inicie novamente no terminal dessa pasta:

   ```powershell
   python bot_mt5_convergencia_10r.py
   ```

**Não gere um token novo.** O download pelo app usa o token que já está salvo no navegador.

## Validação e estado de publicação

- `npm run build`: passou.
- `npx tsx scripts/bridgeScriptAssert.ts`: passou, incluindo a compilação do Python gerado e a
  verificação de preservação do token.
- `git diff --check`: passou.
- `npm run lint`: ainda aponta erros de tipo preexistentes relacionados a `ABSORPTION` em
  `src/components/RenkoFlowChart.tsx`, arquivo não alterado nesta atualização.
- O download e o reinício no Windows precisam ser feitos manualmente.
- Esta atualização ainda não foi commitada nem enviada ao remoto.
