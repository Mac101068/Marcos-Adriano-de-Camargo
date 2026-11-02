import React, { useState } from 'react';

/**
 * Padrão de alerta da plataforma: o SÍMBOLO na faixa e a mensagem inteira num balão
 * flutuante que abre no hover — e no toque, porque celular não tem mouse (o `title`
 * nativo demora e quase não aparece; por isso a mensagem agora é um balão próprio).
 * `align="right"`: o balão cresce para dentro da tela quando o símbolo vive na borda
 * direita (é o caso do alerta de portões, jogado para o fim da tira, embaixo do selo
 * Adm). `stopPropagation`: dentro de um botão (seletor de ativo), o clique mostra o
 * balão sem abrir o dropdown do pai.
 */
export const AlertChip: React.FC<{
  tone: 'amber' | 'rose';
  message: string;
  icon: React.ReactNode;
  align?: 'left' | 'right';
}> = ({ tone, message, icon, align = 'left' }) => {
  const [open, setOpen] = useState(false);
  const toneBox =
    tone === 'rose'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  const toneBubble =
    tone === 'rose' ? 'border-rose-500/40 text-rose-200' : 'border-amber-500/40 text-amber-200';
  return (
    <span
      className="relative flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <span className={`flex items-center justify-center w-6 h-5 rounded border cursor-help ${toneBox}`}>
        {icon}
      </span>
      {open && (
        <span
          className={`pointer-events-none absolute top-full mt-1.5 z-50 w-[min(340px,80vw)] rounded-lg border bg-slate-900/95 p-2.5 text-[10px] font-sans font-medium leading-snug whitespace-pre-line shadow-2xl shadow-black/50 ${toneBubble} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {message}
        </span>
      )}
    </span>
  );
};
