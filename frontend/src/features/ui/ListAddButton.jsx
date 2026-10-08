import React, { forwardRef } from "react";
import { PlusIcon } from "../layout/Icons.jsx";
import "./ListAddButton.css";

// A text-style "+ Add …" row at the end of a list. Use it for adding an item to the list it sits in.
export const ListAddButton = forwardRef(function ListAddButton(
  { children, onClick, disabled = false, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={["list-add-button", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      <PlusIcon size={13} className="list-add-button-icon" />
      {children}
    </button>
  );
});
