import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface MiniSelectOption<T extends string | number> {
  value: T;
  /** O que aparece no botão e em cada linha da lista (ex.: '2x', '3d'). */
  label: string;
  title?: string;
}

interface MiniSelectProps<T extends string | number> {
  value: T;
  options: MiniSelectOption<T>[];
  onChange: (value: T) => void;
  /** Nome curto do que se escolhe — vai no aria-label, para a caixa não ser só um número mudo. */
  label: string;
  title?: string;
  disabled?: boolean;
}

const sameValue = (a: string | number, b: string | number) => String(a) === String(b);

/** Respiro entre botão e menu, e margem que o menu nunca invade nas bordas da tela. */
const GAP = 4;
const GUTTER = 6;

type MenuPos = { left: number; top: number; minWidth: number };

/**
 * Caixa de seleção compacta para a tira de status: o VALOR ATUAL é o botão, e o clique abre as
 * outras opções. Substitui fileira de chips (5 velocidades, 3 dias) que ocupavam largura demais
 * no cabeçalho — a escolha continua visível e acessível em um clique, sem os números repetidos.
 *
 * O menu é `position: fixed` (e NÃO `absolute`) por um motivo funcional: as caixas de velocidade
 * e dias moram dentro de um container `overflow-x-auto`, que RECORTA o que passa das suas bordas.
 * Com `absolute` o menu nascia escondido atrás da própria tira — a caixa parecia morta. Fixed
 * escapa desse recorte, e por isso a posição é medida no botão e refeita sempre que algo rola.
 *
 * Acabamento igual ao resto do chrome: moldura neutra, fundo slate, e cor nenhuma no controle
 * (cor é só indicador de estado). Fecha por click-outside e Esc, como os dropdowns do cabeçalho.
 */
export function MiniSelect<T extends string | number>({
  value,
  options,
  onChange,
  label,
  title,
  disabled,
}: MiniSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => sameValue(o.value, value));

  /** Reposiciona o menu em relação ao botão: vira para cima se não cabe embaixo e não sai da tela. */
  const place = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    const spaceBelow = window.innerHeight - r.bottom;
    // Só inverte se embaixo não cabe E em cima houver mais espaço (senão fica onde nasceu)
    const flipUp = mh + GAP + GUTTER > spaceBelow && r.top > spaceBelow;
    const rawTop = flipUp ? r.top - GAP - mh : r.bottom + GAP;
    const top = Math.max(GUTTER, Math.min(rawTop, window.innerHeight - mh - GUTTER));
    const left = Math.max(GUTTER, Math.min(r.left, window.innerWidth - mw - GUTTER));
    // Sem esta guarda, cada scroll reacenderia o estado com o mesmo valor e re-renderizaria à toa
    setPos((prev) =>
      prev && prev.top === top && prev.left === left && prev.minWidth === r.width
        ? prev
        : { left, top, minWidth: r.width }
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // `true` na fase de captura pega também o scroll da própria tira de status, que não sobe
    // para o window: sem isso o menu ficaria parado enquanto o botão escapasse para o lado.
    const onMove = () => place();
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  // Posiciona antes da pintura (layout effect): o menu nasce invisível e já sai no lugar certo,
  // sem o flash de uma lista no canto superior esquerdo da tela.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-label={`Escolher ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        className={`flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-semibold transition-colors whitespace-nowrap ${
          disabled
            ? 'cursor-wait border-slate-800 text-slate-600 opacity-40'
            : 'cursor-pointer border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-600'
        }`}
      >
        <span className="tabular-nums">{current?.label ?? String(value)}</span>
        <ChevronDown className={`w-2.5 h-2.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          // fixed + estilo inline: fora do recorte do container rolável da tira de status
          style={pos ? { left: pos.left, top: pos.top, minWidth: pos.minWidth } : { visibility: 'hidden' }}
          className="fixed z-[70] min-w-[64px] py-0.5 rounded-md bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/50"
        >
          {options.map((o) => {
            const isActive = sameValue(o.value, value);
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={isActive}
                title={o.title}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full block px-2.5 py-1 text-left text-[10px] font-mono tabular-nums transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-slate-800 text-slate-50 font-bold'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
