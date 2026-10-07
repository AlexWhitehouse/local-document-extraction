import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ApplicationBootstrap } from "./ApplicationBootstrap";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApplicationBootstrap />
  </React.StrictMode>
);
