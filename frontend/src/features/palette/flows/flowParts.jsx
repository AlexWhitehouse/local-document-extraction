import React, { useEffect, useId, useRef, useState } from "react";
import { Field, TextInput } from "../../ui/Field.jsx";
import "./flows.css";

/** One flow step: a heading row, the body and a right-aligned action row with an optional left note. */
export function FlowStep({ title, badge, subtitle, note, actions, children, label }) {
  return (
    <section className="palette-flow" aria-label={label || title}>
      {title ? (
        <header className="palette-flow-head">
          <h3>{title}</h3>
          {badge}
          {subtitle ? <span className="palette-flow-sub">{subtitle}</span> : null}
        </header>
      ) : null}
      <div className="palette-flow-stack">{children}</div>
      {actions ? (
        <div className="palette-flow-actions">
          {note ? <span className="palette-flow-note">{note}</span> : null}
          {actions}
        </div>
      ) : null}
    </section>
  );
}

/** A loading step at a fixed height while the assistant works. */
export function FlowThinking({ label }) {
  return (
    <div className="palette-flow-thinking" role="status">
      <span>{label}</span>
      {[86, 62, 74].map((width) => (
        <span key={width} className="palette-flow-skeleton" style={{ width: `${width}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

/**
 * A filterable, keyboard-navigable list: the filter keeps focus, Arrow keys, Home and End move the
 * highlight and Enter picks it. Items are { id, label, detail?, badge?, icon? }.
 */
export function PickList({ label, placeholder, items, initialQuery = "", emptyMessage, onPick }) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  const current = Math.min(active, visible.length - 1);

  useEffect(() => inputRef.current?.focus(), []);

  const optionId = (index) => `${listId}-option-${index}`;

  const onKeyDown = (event) => {
    const moves = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: visible.length - 1 };

    if (event.key in moves && visible.length) {
      event.preventDefault();
      setActive(Math.max(0, Math.min(visible.length - 1, moves[event.key])));
    } else if (event.key === "Enter" && visible[current]) {
      event.preventDefault();
      event.stopPropagation();
      onPick(visible[current]);
    }
  };

  return (
    <div className="palette-flow-pick">
      <Field label={label} labelHidden>
        <TextInput
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible.length ? optionId(current) : undefined}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </Field>
      <p className="palette-flow-group" aria-hidden="true">
        {label}
      </p>
      <ul id={listId} role="listbox" aria-label={label} className="palette-flow-options">
        {visible.map((item, index) => {
          const Icon = item.icon;

          return (
            <li
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              className={index === current ? "palette-flow-option is-active" : "palette-flow-option"}
              onMouseMove={() => setActive(index)}
              onClick={() => onPick(item)}
            >
              {Icon ? (
                <span className="palette-flow-option-icon" aria-hidden="true">
                  <Icon size={13} />
                </span>
              ) : null}
              <span className="palette-flow-option-text">
                <strong>{item.label}</strong>
                {item.detail ? <span>{item.detail}</span> : null}
              </span>
              {item.badge ? <span className="palette-flow-option-badge">{item.badge}</span> : null}
            </li>
          );
        })}
      </ul>
      {visible.length ? null : <p className="palette-flow-muted">{emptyMessage}</p>}
    </div>
  );
}
