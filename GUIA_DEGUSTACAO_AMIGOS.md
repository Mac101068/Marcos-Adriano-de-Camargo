# 👥 GUIA DE DEGUSTAÇÃO: COMPARTILHAR O ROBÔ COM AMIGOS

Este guia ensina como compartilhar o terminal em tempo real com amigos e parceiros para que eles possam acompanhar o robô operando ao vivo em seus próprios celulares ou computadores.

---

## 1. Compartilhamento na Mesma Rede (Wi-Fi / Casa / Escritório)

1. Certifique-se de que seu amigo está conectado na mesma rede Wi-Fi que o seu computador.
2. Peça para ele abrir o seguinte endereço no navegador (Google Chrome, Safari, etc.):
   👉 **`http://192.168.18.49:3000`**
3. O terminal abrirá automaticamente em **Modo Degustação (Trial 15 dias)**.
4. Seu amigo terá acesso a:
   * Gráfico Renko 10R com indicador de fluxo institucional Heikin-Ashi.
   * Fita de Times & Trades com agressões ao vivo.
   * Curva de patrimônio e auditoria de trades.
   * **Sem bloqueios de tela (paywall)** e **sem acesso às configurações de Admin Master**.

---

## 2. Gerar Convite Personalizado no WhatsApp

1. No topo da tela do seu computador, clique no botão **"Convidar Amigo"**.
2. Digite o nome do amigo (ex: *André*).
3. Selecione o período de teste desejado (**7 dias**, **15 dias** ou **30 dias**).
4. Clique em **"Gerar Convite"**.
5. Clique em **"Enviar Convite no WhatsApp"**. O WhatsApp Web abrirá com a mensagem pronta:
   > *"Fala André! O Marcos liberou seu acesso de degustação VIP ao Robô Quantitativo de Fluxo & Renko 10R na B3. Acompanhe os trades ao vivo pelo seu celular: http://192.168.18.49:3000/?invite=André&days=15"*

---

## 3. Compartilhamento Externo (Pela Internet / 4G / Fora de Casa)

Se o amigo não estiver na sua casa ou escritório (estiver em outra cidade ou usando o 4G do celular), você pode gerar um link público seguro com apenas um comando no terminal:

```powershell
npx localtunnel --port 3000
```

Este comando gerará uma URL pública como:
`https://robo-b3-marcos.loca.lt`

Basta enviar esse link para seu amigo e ele poderá acompanhar o robô de qualquer lugar do mundo!
