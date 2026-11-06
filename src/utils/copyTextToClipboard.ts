export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection-based copy path when clipboard permissions are unavailable.
    }
  }

  if (typeof document === 'undefined' || !document.body || !document.execCommand) {
    throw new Error('A cópia não está disponível neste navegador.');
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.appendChild(field);
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);

  try {
    if (!document.execCommand('copy')) {
      throw new Error('O navegador não permitiu copiar o texto.');
    }
  } finally {
    field.remove();
  }
}
