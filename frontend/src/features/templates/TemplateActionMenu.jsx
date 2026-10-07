import React, { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "../ui/Button.jsx";
import "./TemplateActionMenu.css";

// An icon button that opens a small menu of actions. The menu is fixed to the trigger,
// so it is not clipped by scrolling lists. Escape and outside clicks close it.
export function TemplateActionMenu({ label, icon, items, disabled = false, size = "sm", className }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const [position, setPosition] = useState(null);
  const open = position !== null;

  useEffect(() => {
    if (!open) return undefined;

    menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();

    const close = () => setPosition(null);

    // Capture phase, so Escape closes this menu without also closing an enclosing dialog.
    function onKeyDown(event) {
      if (event.key !== "Escape") return;

      event.stopPropagation();
      setPosition(null);
      triggerRef.current?.focus();
    }

    function onPointerDown(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close();
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setPosition(null);

      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  function choose(item) {
    setPosition(null);
    triggerRef.current?.focus();
    item.onSelect();
  }

  function moveFocus(event) {
    if (event.key === "Tab") {
      setPosition(null);

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();

    const menuItems = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const current = menuItems.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;

    menuItems[(current + step + menuItems.length) % menuItems.length]?.focus();
  }

  return (
    <>
      <IconButton
        ref={triggerRef}
        label={label}
        icon={icon}
        size={size}
        className={className}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      />
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="template-action-menu"
          style={{ top: position.top, right: position.right }}
          onKeyDown={moveFocus}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={item.danger ? "template-action-menu-item danger" : "template-action-menu-item"}
              disabled={item.disabled}
              onClick={() => choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
