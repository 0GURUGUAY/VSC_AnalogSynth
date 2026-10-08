import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { GripVertical } from "lucide-react";
import type { Facade } from "./types";

export function PatchModuleOrder({ facades, disabled, onMove, renderFacade, children }: {
  facades: Facade[];
  disabled: boolean;
  onMove: (id: string, targetId: string, position: "before" | "after") => void;
  renderFacade: (facade: Facade) => ReactNode;
  children?: ReactNode;
}) {
  const draggedId = useRef("");
  const [dragging, setDragging] = useState("");
  const [target, setTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const movable = !disabled && facades.length > 1;

  function reset() {
    draggedId.current = "";
    setDragging("");
    setTarget(null);
  }

  return <div className="facade-gallery" aria-label="Ordre des modules du PATCH"
    onDragOver={(event) => {
      if (!movable || !draggedId.current) return;
      const gallery = event.currentTarget;
      const bounds = gallery.getBoundingClientRect();
      if (event.clientX < bounds.left + 40) gallery.scrollBy({ left: -15 });
      else if (event.clientX > bounds.right - 40) gallery.scrollBy({ left: 15 });
    }}
    onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setTarget(null);
    }}>
    {facades.map((facade, index) => <div key={facade.id}
      className={`facade-order-item${dragging === facade.id ? " dragging" : ""}${target?.id === facade.id ? ` drop-${target.position}` : ""}`}
      onDragOver={(event) => {
        if (!movable || !draggedId.current || draggedId.current === facade.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        setTarget({ id: facade.id, position: event.clientX < bounds.left + bounds.width / 2 ? "before" : "after" });
      }}
      onDrop={(event) => {
        if (!movable || !draggedId.current) { reset(); return; }
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onMove(draggedId.current, facade.id, event.clientX < bounds.left + bounds.width / 2 ? "before" : "after");
        reset();
      }}>
      {renderFacade(facade)}
      <button type="button" className="facade-drag-handle" draggable={movable} disabled={!movable}
        aria-label={`Déplacer ${facade.name}`}
        title="Glisser pour déplacer · flèches gauche/droite au clavier"
        onDragStart={(event) => {
          if (!movable) { event.preventDefault(); return; }
          draggedId.current = facade.id;
          setDragging(facade.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", facade.id);
          const card = event.currentTarget.parentElement;
          if (card) event.dataTransfer.setDragImage(card, 30, 20);
        }}
        onDragEnd={reset}
        onKeyDown={(event) => {
          const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          if (!movable || !offset) return;
          event.preventDefault();
          const neighbor = facades[index + offset];
          if (neighbor) onMove(facade.id, neighbor.id, offset < 0 ? "before" : "after");
        }}><GripVertical size={16} aria-hidden="true" /></button>
    </div>)}
    {children}
  </div>;
}
