import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Linha de lista que concentra os dados e abre embaixo ao clicar (acordeão).
 *
 * Substitui a pilha de quadros sempre-abertos: cada grupo vira UMA linha com um resumo do que
 * importa (a "lista concentrando os dados"); o clique despeja os campos logo abaixo, um grupo
 * após o outro. É o mesmo micropadrão usado no retrato do Estúdio e no painel de Parâmetros,
 * então as duas telas respiram igual (regra 8/13: uma forma, uma leitura).
 *
 * Sem dependência de breakpoint: a lista empilha do celular ao desktop.
 */
interface CollapsibleSectionProps {
  title: string;
  /** Ícone de lucide (ElementType) — fica miúdo à esquerda da linha. */
  icon?: React.ElementType;
  iconClass?: string;
  /** Resumo de 1 linha com os valores que dispensam abrir o grupo. */
  summary?: React.ReactNode;
  /** Chip à direita, antes da seta (ex.: "PAPEL · SEM ORDEM REAL"). */
  trailing?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon: Icon,
  iconClass = 'text-emerald-400',
  summary,
  trailing,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  return (
    <section className={`rounded-xl border shadow-sm transition-colors ${open ? 'border-slate-700 bg-slate-900/70' : 'border-slate-800 bg-slate-900/50'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-start gap-2 px-3 py-2.5 text-left cursor-pointer"
        title={open ? 'Fechar este grupo' : 'Abrir este grupo'}
      >
        {Icon && <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} />}
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold text-slate-200">{title}</span>
          {!open && summary && (
            <span className="block text-[10px] font-mono text-slate-500 mt-0.5 truncate">{summary}</span>
          )}
        </span>
        {trailing}
        <ChevronDown className={`w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 pt-2.5 space-y-3 border-t border-slate-800/70">{children}</div>}
    </section>
  );
};
