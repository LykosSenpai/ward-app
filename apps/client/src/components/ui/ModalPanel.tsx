import { useEffect } from "react";
import type { ReactNode } from "react";

type ModalPanelProps = {
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  blocking?: boolean;
};

export function ModalPanel({
  title,
  children,
  onClose,
  wide = false,
  blocking = false
}: ModalPanelProps) {
  useEffect(() => {
    if (!onClose || blocking) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [blocking, onClose]);

  return (
    <div
      className={blocking ? "modal-backdrop blocking" : "modal-backdrop"}
      role="dialog"
      aria-modal="true"
      onMouseDown={event => {
        if (!onClose || blocking || event.target !== event.currentTarget) return;
        onClose();
      }}
    >
      <div className={wide ? "modal-panel modal-panel-wide" : "modal-panel"} onMouseDown={event => event.stopPropagation()}>
        {(title || onClose) && (
          <div className="modal-header">
            {title ? <h2>{title}</h2> : <span />}

            {onClose && (
              <button className="modal-close-button" onClick={onClose} aria-label="Close modal">
                Close
              </button>
            )}
          </div>
        )}

        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
