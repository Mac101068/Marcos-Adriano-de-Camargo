# REGRAS DE TRABALHO ENTRE AS INSTÂNCIAS — versão curta

O operador mandou a gente se virar. Então isto aqui é o contrato mínimo para não colidir.
Curto de propósito: regra que ninguém lê não protege ninguém.

## 1. Um dono por arquivo, por vez

Antes de começar, escreva seu nome no arquivo de trava:

- `canal/trava-<arquivo>.md` → conteúdo: quem está mexendo e desde quando.

Exemplo: `canal/trava-App.tsx.md` com `mac · 07/11 17:20`.

Se a trava existir e for da outra instância: **não encoste no arquivo**. Trabalhe em outro.
Se a trava for sua e estiver velha (mais de 2h), pode reassumir — mas avise na mensagem.

## 2. Arquivos que colidem de verdade

`src/App.tsx` e `src/utils/pythonScriptGenerator.ts` são os dois que já causaram retrabalho.
Neles, a regra 1 é obrigatória. Nos outros, bom senso.

## 3. Commit pequeno, push frequente

Um commit = uma mudança com nome que diz o que mudou. Nada de commit gigante no fim do dia:
quanto maior o intervalo entre pushes, maior o merge manual.

## 4. Sempre puxe antes de empurrar

```
git pull --rebase origin main
npx tsc --noEmit
git push origin main
```

Se o `tsc` estiver vermelho, **não empurre**. O `main` é a linha de trabalho do operador.

## 5. Não desfaça o do outro

Se você discorda de uma escolha da outra instância, **não reverta**. Escreva aqui o motivo e
deixe o operador decidir. Reverter trabalho alheio sem avisar é o pior dos cenários.

## 6. Fato com prova

Afirmação sem comando e saída não vale. "Está funcionando" não é informação; `netstat` é.

## 7. Mensagem só quando precisa

O operador cortou a correspondência longa. Escreva aqui quando:
- precisar de decisão dele;
- for mexer num arquivo travado pela outra;
- descobrir algo que muda o trabalho da outra instância (ex.: chave da ponte mudou).

Fora disso, trabalhe calado.

## 8. Ponte: uma só

A 8765 é do Windows — é onde o MT5 está logado. O Mac nunca sobe a ponte.
Endereço: `192.168.18.154:8765`, chave fixa em `src/utils/bridgeSecurity.ts`.

---

## Estado no momento em que escrevi isto

- `main` em `cec97b7` (Windows).
- Nenhuma trava ativa.
- Windows livre. Mac livre.

*Escrito pela instância Windows, 07/11/2026.*
