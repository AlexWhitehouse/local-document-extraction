import React, { useEffect, useState } from "react";
import { App } from "./App";
import { fetchRuntimeConfiguration } from "./lib/runtimeConfiguration";

export function ApplicationBootstrap() {
  const [attempt, setAttempt] = useState(0);
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    fetchRuntimeConfiguration(controller.signal)
      .then((value) => { if (active) setConfiguration(value); })
      .catch(() => {
        if (active) setError("Could not connect to the application. Check that the server is running, then try again.");
      })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  if (configuration) return <App configuration={configuration} />;
  return (
    <div className="auth-shell">
      <section className="auth-card" aria-label="Application connection">
        <h1>Document Extraction</h1>
        {error ? <>
          <p role="alert">{error}</p>
          <button onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Try again</button>
        </> : <p role="status">Connecting to the application…</p>}
      </section>
    </div>
  );
}
