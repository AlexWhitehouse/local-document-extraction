import React from "react";
import { followAppLink } from "../../lib/appRoutes";

export function NavigationLink({ href, onClick, children, ...props }) {
  return href ? (
    <a {...props} href={href} onClick={event => followAppLink(event, onClick)}>{children}</a>
  ) : (
    <button {...props} type="button" onClick={onClick}>{children}</button>
  );
}
