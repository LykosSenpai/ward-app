export async function copyMarketplaceText(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;

  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below for browsers that block Clipboard API calls.
  }

  const documentRef = globalThis.document;
  if (!documentRef?.body) return false;

  const textArea = documentRef.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.left = "0";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  textArea.style.position = "fixed";
  textArea.style.top = "0";

  documentRef.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    return documentRef.execCommand("copy");
  } catch {
    return false;
  } finally {
    documentRef.body.removeChild(textArea);
  }
}
